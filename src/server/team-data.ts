import { createServerFn } from '@tanstack/react-start';
import type { Message } from '~/db/messages';
import { getDb } from './db';
import type { TeamMeta } from './teams';
import { orderedMembers, readTeams, resolveCwd } from './teams';

export type AgentSessionMessage = {
  type: 'user' | 'assistant' | 'system';
  uuid: string;
  session_id: string;
  // biome-ignore lint/suspicious/noExplicitAny: raw Claude API message shape
  message: Record<string, any>;
  parent_tool_use_id: null;
};

const AGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Extract @name mentions from message content, matched against known names. */
export function parseMentions(content: string, knownNames: string[]): string[] {
  return knownNames.filter((name) =>
    new RegExp(`@${name}(?![\\w-])`).test(content),
  );
}

/** Returns true if the content @mentions the user, signalling conversation pause. */
function mentionsUser(content: string): boolean {
  return content.includes('@user');
}

/**
 * Reads agent metadata (name, description) for all team members.
 * Used to build the team context section of system prompts.
 */
async function readTeamMemberMeta(
  cwd: string,
  team: TeamMeta,
): Promise<Array<{ name: string; description: string; isLead: boolean }>> {
  const { readAgentMeta } = await import('./agent-runner');
  return Promise.all(
    orderedMembers(team).map(async (name) => {
      try {
        const meta = await readAgentMeta(cwd, name);
        return {
          name,
          description: meta.description,
          isLead: name === team.lead,
        };
      } catch {
        return { name, description: '', isLead: name === team.lead };
      }
    }),
  );
}

type RunAgentFn = (opts: {
  agentName: string;
  userMessage: string;
  chatContext?: Message[];
  teamMembers?: Array<{ name: string; description: string; isLead: boolean }>;
  teamName?: string;
  teamFolder?: string;
  projectBranch?: string;
  cwd: string;
  existingSdkSessionId?: string;
  onStatus?: (status: 'idle' | 'working', statusText?: string) => void;
  onSessionId?: (sessionId: string) => void;
}) => Promise<string>;

/**
 * Runs the multi-agent conversation loop until the conversation reaches a
 * natural pause point or MAX_AGENT_TURNS is hit.
 *
 * Routing is fully deterministic — no LLM judge. Each iteration inspects
 * the last message:
 *   - @user mention → stop; hand back to human
 *   - User message, no @mentions → team lead responds
 *   - Any message with @agent mentions → those agents respond
 *   - Team lead message, no @mentions → stop; assumed to be for user
 *   - Non-lead agent message, no @mentions → team lead responds
 *
 * The 5-minute per-agent timeout is the only guard against runaway turns.
 */
export async function runConversationLoop({
  db,
  teamId,
  team,
  cwd,
  teamMemberMeta,
  projectBranch,
  projectId,
  runAgentFn,
}: {
  db: import('~/db/index').Database;
  teamId: string;
  team: TeamMeta;
  cwd: string;
  teamMemberMeta: Array<{ name: string; description: string; isLead: boolean }>;
  projectBranch?: string;
  /** When set, sessions and messages are scoped to this project rather than the team. */
  projectId?: string;
  /** Injectable for tests — defaults to the real runAgent when omitted. */
  runAgentFn?: RunAgentFn;
}): Promise<void> {
  const { join } = await import('node:path');
  const {
    getProjectMessages: getProjectMessagesDb,
    getTeamMessages,
    insertMessage,
  } = await import('~/db/messages');
  const { getSession, setSessionSdkId, upsertSession } = await import(
    '~/db/sessions'
  );

  /** Fetch the most recent messages in the right scope (team or project). */
  const getRecentMessages = () =>
    projectId
      ? getProjectMessagesDb(db, projectId).slice(-20)
      : getTeamMessages(db, teamId).slice(-20);

  // Build the default runAgent wrapper that handles DB status persistence.
  // Tests override this entirely via runAgentFn.
  const { runAgent } = await import('./agent-runner');
  const defaultRunAgent: RunAgentFn = (opts) => {
    const existing = getSession(db, teamId, opts.agentName, projectId);
    return runAgent({
      ...opts,
      existingSdkSessionId: existing?.sdk_session_id ?? undefined,
      onStatus: (status, statusText) => {
        upsertSession(
          db,
          teamId,
          opts.agentName,
          status,
          statusText,
          projectId,
        );
      },
      onSessionId: (sessionId) => {
        setSessionSdkId(db, teamId, opts.agentName, sessionId, projectId);
      },
    });
  };

  const runAgentImpl = runAgentFn ?? defaultRunAgent;

  const allAgentNames = teamMemberMeta.map((m) => m.name);
  const teamFolder = join('.nightshift', 'teams', team.name);

  while (true) {
    const recentMessages = getRecentMessages();
    const lastMessage = recentMessages[recentMessages.length - 1];
    if (!lastMessage) break;

    // @user mention → conversation explicitly handed back to human
    if (mentionsUser(lastMessage.content)) break;

    const mentions = parseMentions(lastMessage.content, allAgentNames);

    let nextResponders: string[];

    if (mentions.length > 0) {
      // Explicit @mentions are authoritative — always route to the named agents
      nextResponders = mentions;
    } else if (lastMessage.sender === 'user') {
      // User message with no @mentions → team lead handles it
      nextResponders = allAgentNames.includes(team.lead) ? [team.lead] : [];
    } else if (lastMessage.sender === team.lead) {
      // Team lead sent a message without any @mentions →
      // assumed to be directed at the user; pause and wait
      break;
    } else {
      // Non-lead agent sent a message with no @mentions → team lead fields it
      nextResponders = allAgentNames.includes(team.lead) ? [team.lead] : [];
    }

    if (nextResponders.length === 0) break;

    // Run each queued agent in sequence, inserting messages into the DB as they finish
    for (const agentName of nextResponders) {
      const chatContext = getRecentMessages();
      const triggerContent = chatContext[chatContext.length - 1]?.content ?? '';

      let responseText: string;
      try {
        const agentPromise = runAgentImpl({
          agentName,
          userMessage: triggerContent,
          chatContext,
          teamMembers: teamMemberMeta,
          teamName: team.name,
          teamFolder,
          projectBranch,
          cwd,
        });
        // Race against a timeout so a hung SDK stream can't lock the conversation
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Agent ${agentName} timed out after ${AGENT_TIMEOUT_MS / 60000} minutes`,
                ),
              ),
            AGENT_TIMEOUT_MS,
          ),
        );
        responseText = await Promise.race([agentPromise, timeoutPromise]);
      } catch (err) {
        console.error(`[nightshift] agent ${agentName} failed:`, err);
        // Force the session idle in case runAgent's finally block never ran
        upsertSession(db, teamId, agentName, 'idle', undefined, projectId);
        // Return rather than break — the failed agent never inserted a message,
        // so the last DB message is unchanged. Continuing the outer loop would
        // re-route to the same agent and loop forever.
        return;
      }

      const mentionedAgents = parseMentions(responseText, allAgentNames);
      insertMessage(
        db,
        teamId,
        agentName,
        responseText,
        projectId,
        mentionedAgents,
      );

      // Stop immediately if the agent is handing back to the user
      if (mentionsUser(responseText)) return;
    }
  }
}

export const getTeamView = createServerFn({ method: 'GET' })
  .inputValidator((data: { teamId: string }) => data)
  .handler(async ({ data }) => {
    const { getOpenProjectsByTeam } = await import('~/db/projects');
    const { getTeamMessages } = await import('~/db/messages');
    const { getSessionsByTeam } = await import('~/db/sessions');

    const cwd = await resolveCwd();
    const [db, teams] = await Promise.all([getDb(), readTeams(cwd)]);
    const team = teams.find((t) => t.name === data.teamId);
    if (!team) throw new Error(`Team not found: ${data.teamId}`);

    const projects = getOpenProjectsByTeam(db, data.teamId);
    const messages = getTeamMessages(db, data.teamId);
    const sessions = getSessionsByTeam(db, data.teamId);

    const agents = orderedMembers(team).map((name) => {
      const session = sessions.find((s) => s.agent_name === name);
      return {
        name,
        isLead: name === team.lead,
        status: (session?.status ?? 'idle') as 'idle' | 'working',
        statusText: session?.status_text ?? null,
      };
    });

    return { team, agents, projects, messages };
  });

export const getLatestMessages = createServerFn({ method: 'GET' })
  .inputValidator((data: { teamId: string }) => data)
  .handler(async ({ data }) => {
    const { getTeamMessages } = await import('~/db/messages');
    const db = await getDb();
    return getTeamMessages(db, data.teamId);
  });

/** Resolves lead name, agent name list, and member metadata for a team. */
async function resolveTeamContext(cwd: string, team: TeamMeta | undefined) {
  const leadName = team?.lead ?? 'project-lead';
  const allAgentNames = team ? orderedMembers(team) : [leadName];
  const teamMemberMeta = team
    ? await readTeamMemberMeta(cwd, team)
    : [{ name: leadName, description: '', isLead: true }];
  return { leadName, allAgentNames, teamMemberMeta };
}

export const sendTeamMessage = createServerFn({ method: 'POST' })
  .inputValidator((data: { teamId: string; content: string }) => data)
  .handler(async ({ data }) => {
    const { insertMessage } = await import('~/db/messages');
    const { resetStuckSessions } = await import('~/db/sessions');

    const cwd = await resolveCwd();
    const [db, teams] = await Promise.all([getDb(), readTeams(cwd)]);

    // Reset any agents stuck in 'working' from a previous hung conversation
    resetStuckSessions(db, data.teamId);

    const team = teams.find((t) => t.name === data.teamId);
    const { leadName, allAgentNames, teamMemberMeta } =
      await resolveTeamContext(cwd, team);

    // Insert the user message, recording any @mentions so the loop sees them
    const userMentions = parseMentions(data.content, allAgentNames);
    insertMessage(
      db,
      data.teamId,
      'user',
      data.content,
      undefined,
      userMentions,
    );

    await runConversationLoop({
      db,
      teamId: data.teamId,
      team: team ?? { name: data.teamId, lead: leadName, members: [] },
      cwd,
      teamMemberMeta,
    });

    return { ok: true };
  });

export const getAgentStatuses = createServerFn({ method: 'GET' })
  .inputValidator((data: { teamId: string; projectId?: string }) => data)
  .handler(async ({ data }) => {
    const { getSessionsByTeam } = await import('~/db/sessions');
    const db = await getDb();
    return getSessionsByTeam(db, data.teamId, data.projectId);
  });

export const getProjectMessages = createServerFn({ method: 'GET' })
  .inputValidator((data: { teamId: string; projectId: string }) => data)
  .handler(async ({ data }) => {
    const { getProjectMessages: getProjectMsgs } = await import(
      '~/db/messages'
    );
    const db = await getDb();
    return getProjectMsgs(db, data.projectId);
  });

export const sendProjectMessage = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { teamId: string; projectId: string; content: string }) => data,
  )
  .handler(async ({ data }) => {
    const { insertMessage } = await import('~/db/messages');
    const { resetStuckSessions } = await import('~/db/sessions');
    const { getProjectsByTeam } = await import('~/db/projects');

    const cwd = await resolveCwd();
    const [db, teams] = await Promise.all([getDb(), readTeams(cwd)]);

    resetStuckSessions(db, data.teamId, data.projectId);

    const team = teams.find((t) => t.name === data.teamId);
    const { leadName, allAgentNames, teamMemberMeta } =
      await resolveTeamContext(cwd, team);

    const userMentions = parseMentions(data.content, allAgentNames);
    insertMessage(
      db,
      data.teamId,
      'user',
      data.content,
      data.projectId,
      userMentions,
    );

    const project = getProjectsByTeam(db, data.teamId).find(
      (p) => p.id === data.projectId,
    );

    const projectCwd = await resolveProjectCwd(cwd, project?.branch);

    await runConversationLoop({
      db,
      teamId: data.teamId,
      team: team ?? { name: data.teamId, lead: leadName, members: [] },
      cwd: projectCwd,
      teamMemberMeta,
      projectBranch: project?.branch,
      projectId: data.projectId,
    });

    return { ok: true };
  });

export const getAgentSession = createServerFn({ method: 'GET' })
  .inputValidator(
    (data: { teamId: string; agentName: string; projectId?: string }) => data,
  )
  .handler(async ({ data }) => {
    const { getSession } = await import('~/db/sessions');
    const db = await getDb();

    const session = getSession(db, data.teamId, data.agentName, data.projectId);
    if (!session?.sdk_session_id) {
      return {
        messages: [] as AgentSessionMessage[],
        status: (session?.status ?? 'idle') as 'idle' | 'working',
        statusText: session?.status_text ?? null,
      };
    }

    const { getSessionMessages } = await import(
      '@anthropic-ai/claude-agent-sdk'
    );
    const messages = (await getSessionMessages(
      session.sdk_session_id,
    )) as AgentSessionMessage[];

    return {
      messages,
      status: session.status,
      statusText: session.status_text,
    };
  });

/**
 * Returns the worktree path for the project's branch if a worktree exists,
 * otherwise falls back to the git root cwd.
 * Exported for testing.
 */
export async function resolveProjectCwd(
  cwd: string,
  projectBranch: string | undefined,
): Promise<string> {
  if (!projectBranch) return cwd;
  const { findProjectWorktreePath } = await import('./worktrees');
  const worktreePath = await findProjectWorktreePath(cwd, projectBranch);
  return worktreePath ?? cwd;
}

export const createNewProject = createServerFn({ method: 'POST' })
  .inputValidator((data: { teamId: string; name: string }) => data)
  .handler(async ({ data }) => {
    const { branchExists } = await import('~/db/projects');
    const { join } = await import('node:path');
    const { createProjectWithWorktree } = await import('./worktrees');

    const cwd = await resolveCwd();
    const db = await getDb();

    const base =
      data.name
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '') || 'new-project';
    const branch = branchExists(db, base)
      ? `${base}-${Math.random().toString(16).slice(2, 6)}`
      : base;
    const worktreePath = join(cwd, '.nightshift', 'worktrees', branch);
    return createProjectWithWorktree(
      cwd,
      worktreePath,
      data.name,
      data.teamId,
      branch,
      db,
    );
  });
