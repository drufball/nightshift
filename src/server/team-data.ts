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

const MAX_AGENT_TURNS = 6;
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

/**
 * LLM judge: given recent conversation, decides which agents (if any) should
 * respond next. Returns an empty array to signal "wait for user".
 *
 * The system prompt is passed in — read it once at the call site so this
 * function stays pure and independently testable.
 */
export async function runConversationJudge(
  messages: Message[],
  team: TeamMeta,
  allAgentNames: string[],
  systemPrompt: string,
): Promise<string[]> {
  const roster = allAgentNames
    .map((name) => `- ${name}${name === team.lead ? ' (lead)' : ''}`)
    .join('\n');

  const history = messages
    .slice(-15)
    .map((m) => `${m.sender === 'user' ? 'User' : m.sender}: ${m.content}`)
    .join('\n');

  const userPrompt = `## Team Roster\n${roster}\n\n## Conversation\n${history}`;

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw =
    response.content[0].type === 'text'
      ? response.content[0].text.trim()
      : '{}';

  // Strip markdown code fences if the model wrapped the JSON (e.g. ```json ... ```)
  const text = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const parsed = JSON.parse(text); // throws on invalid JSON — caller handles it
  if (!Array.isArray(parsed.next_responders)) {
    throw new Error(`Judge returned unexpected shape: ${text}`);
  }
  // Only allow valid agent names
  return (parsed.next_responders as string[]).filter((r) =>
    allAgentNames.includes(r),
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
 * Each iteration looks at the last message in the DB:
 *   - If it contains @mentions → those agents respond (judge is skipped)
 *   - If no @mentions → the judge decides who (if anyone) responds next
 *
 * The loop stops when @user is mentioned, the judge returns [], or we hit
 * the turn limit.
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

  // Read the judge system prompt once before entering the loop — avoid a
  // disk read on every iteration and keep runConversationJudge pure.
  const { readFile } = await import('node:fs/promises');
  const specPath = new URL('./conversation-timing.spec.md', import.meta.url)
    .pathname;
  const judgeSystemPrompt = await readFile(specPath, 'utf-8');

  const allAgentNames = teamMemberMeta.map((m) => m.name);
  const respondedAgents = new Set<string>();
  const teamFolder = join('.nightshift', 'teams', team.name);
  let totalTurns = 0;

  while (totalTurns < MAX_AGENT_TURNS) {
    const recentMessages = getRecentMessages();
    const lastMessage = recentMessages[recentMessages.length - 1];
    if (!lastMessage) break;

    // A @user mention means the conversation is explicitly handing back to the user
    if (mentionsUser(lastMessage.content)) break;

    // Determine who should respond to the last message
    const mentions = parseMentions(lastMessage.content, allAgentNames);

    // Track whether this turn was driven by an explicit @mention in a user message.
    // After those agents respond we stop — the judge should not add unsolicited agents.
    const userMentionTrigger =
      mentions.length > 0 && lastMessage.sender === 'user';

    let nextResponders: string[];
    if (mentions.length > 0) {
      // @mentions are authoritative — run exactly those agents, skip the judge
      nextResponders = mentions.filter((n) => !respondedAgents.has(n));
    } else {
      // No @mentions — ask the judge
      let judgeResult: string[] = [];
      try {
        judgeResult = await runConversationJudge(
          recentMessages,
          team,
          allAgentNames,
          judgeSystemPrompt,
        );
      } catch (err) {
        // Judge failed (API error, bad JSON, etc.) — fall back to the lead,
        // unless the lead just spoke (which would create a loop).
        console.error(
          '[nightshift] conversation judge failed, falling back to lead:',
          err,
        );
        const lead = team.lead;
        if (
          lastMessage.sender !== lead &&
          !respondedAgents.has(lead) &&
          allAgentNames.includes(lead)
        ) {
          judgeResult = [lead];
        }
      }

      nextResponders = judgeResult.filter((n) => !respondedAgents.has(n));
    }

    if (nextResponders.length === 0) break;

    // Run each queued agent in sequence, inserting messages into the DB as they finish
    for (const agentName of nextResponders) {
      if (totalTurns >= MAX_AGENT_TURNS) break;

      totalTurns++;
      respondedAgents.add(agentName);

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
        break;
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

    // When this turn was driven by an explicit @mention in a user message, stop here.
    // The mentioned agents have responded; don't let the judge queue additional agents.
    if (userMentionTrigger) break;
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

    await runConversationLoop({
      db,
      teamId: data.teamId,
      team: team ?? { name: data.teamId, lead: leadName, members: [] },
      cwd,
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

export const createNewProject = createServerFn({ method: 'POST' })
  .inputValidator((data: { teamId: string; name: string }) => data)
  .handler(async ({ data }) => {
    const { insertProject } = await import('~/db/projects');
    const db = await getDb();
    const branch =
      data.name
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '') || 'new-project';
    return insertProject(db, data.name, data.teamId, branch);
  });
