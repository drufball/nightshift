import { createServerFn } from '@tanstack/react-start';
import type { Message } from '~/db/messages';
import { getDb } from './db';
import type { TeamMeta } from './teams';
import { readTeams, resolveCwd } from './teams';

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
  return knownNames.filter((name) => content.includes(`@${name}`));
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
  const allNames = [team.lead, ...team.members.filter((m) => m !== team.lead)];
  return Promise.all(
    allNames.map(async (name) => {
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
 * Uses conversation-timing.spec.md as its live system prompt — edit that file
 * to tune routing behavior without touching code.
 */
async function runConversationJudge(
  messages: Message[],
  team: TeamMeta,
  allAgentNames: string[],
): Promise<string[]> {
  const { readFile } = await import('node:fs/promises');

  const specPath = new URL('./conversation-timing.spec.md', import.meta.url)
    .pathname;
  const systemPrompt = await readFile(specPath, 'utf-8');

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
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  const parsed = JSON.parse(text); // throws on invalid JSON — caller handles it
  if (!Array.isArray(parsed.next_responders)) {
    throw new Error(`Judge returned unexpected shape: ${text}`);
  }
  // Only allow valid agent names
  return (parsed.next_responders as string[]).filter((r) => allAgentNames.includes(r));
}

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
async function runConversationLoop({
  db,
  teamId,
  team,
  cwd,
  teamMemberMeta,
  projectBranch,
}: {
  db: import('~/db/index').Database;
  teamId: string;
  team: TeamMeta;
  cwd: string;
  teamMemberMeta: Array<{ name: string; description: string; isLead: boolean }>;
  projectBranch?: string;
}): Promise<void> {
  const { runAgent } = await import('./agent-runner');
  const { join } = await import('node:path');
  const { insertMessage, getTeamMessages } = await import('~/db/messages');

  const allAgentNames = teamMemberMeta.map((m) => m.name);
  const respondedAgents = new Set<string>();
  const teamFolder = join('.nightshift', 'teams', team.name);
  let totalTurns = 0;

  while (totalTurns < MAX_AGENT_TURNS) {
    const recentMessages = getTeamMessages(db, teamId).slice(-20);
    const lastMessage = recentMessages[recentMessages.length - 1];
    if (!lastMessage) break;

    // A @user mention means the conversation is explicitly handing back to the user
    if (mentionsUser(lastMessage.content)) break;

    // Determine who should respond to the last message
    const mentions = parseMentions(lastMessage.content, allAgentNames);

    let nextResponders: string[];
    if (mentions.length > 0) {
      // @mentions are authoritative — run exactly those agents, skip the judge
      nextResponders = mentions.filter((n) => !respondedAgents.has(n));
    } else {
      // No @mentions — ask the judge
      let judgeResult: string[] = [];
      try {
        judgeResult = await runConversationJudge(recentMessages, team, allAgentNames);
      } catch (err) {
        // Judge failed (API error, bad JSON, etc.) — fall back to the lead,
        // unless the lead just spoke (which would create a loop).
        console.error('[nightshift] conversation judge failed, falling back to lead:', err);
        const lead = team.lead;
        if (lastMessage.sender !== lead && !respondedAgents.has(lead) && allAgentNames.includes(lead)) {
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

      const chatContext = getTeamMessages(db, teamId).slice(-20);
      const triggerContent = chatContext[chatContext.length - 1]?.content ?? '';

      let responseText: string;
      try {
        const agentPromise = runAgent({
          db,
          teamId,
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
        const { upsertSession } = await import('~/db/sessions');
        upsertSession(db, teamId, agentName, 'idle', undefined);
        break;
      }

      const mentionedAgents = parseMentions(responseText, allAgentNames);
      insertMessage(
        db,
        teamId,
        agentName,
        responseText,
        undefined,
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

    const [db, teams] = await Promise.all([
      getDb(),
      readTeams(await resolveCwd()),
    ]);
    const team = (teams as TeamMeta[]).find((t) => t.name === data.teamId);
    if (!team) throw new Error(`Team not found: ${data.teamId}`);

    const projects = getOpenProjectsByTeam(db, data.teamId);
    const messages = getTeamMessages(db, data.teamId);
    const sessions = getSessionsByTeam(db, data.teamId);

    const agentNames = [
      team.lead,
      ...team.members.filter((m: string) => m !== team.lead),
    ];
    const agents = agentNames.map((name) => {
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

export const sendTeamMessage = createServerFn({ method: 'POST' })
  .inputValidator((data: { teamId: string; content: string }) => data)
  .handler(async ({ data }) => {
    const { insertMessage } = await import('~/db/messages');

    const [db, teams, cwd] = await Promise.all([
      getDb(),
      readTeams(await resolveCwd()),
      resolveCwd(),
    ]);

    // Reset any agents stuck in 'working' from a previous hung conversation
    const { getSessionsByTeam, upsertSession: resetSession } = await import(
      '~/db/sessions'
    );
    for (const session of getSessionsByTeam(db, data.teamId)) {
      if (session.status === 'working') {
        resetSession(
          db,
          data.teamId,
          session.agent_name,
          'idle',
          undefined,
          session.project_id ?? undefined,
        );
      }
    }

    const team = (teams as TeamMeta[]).find(
      (t: TeamMeta) => t.name === data.teamId,
    );
    const leadName = team?.lead ?? 'project-lead';
    const allAgentNames = team
      ? [team.lead, ...team.members.filter((m) => m !== team.lead)]
      : [leadName];

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

    const teamMemberMeta = team
      ? await readTeamMemberMeta(cwd, team)
      : [{ name: leadName, description: '', isLead: true }];

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
  .inputValidator((data: { teamId: string }) => data)
  .handler(async ({ data }) => {
    const { getSessionsByTeam } = await import('~/db/sessions');
    const db = await getDb();
    return getSessionsByTeam(db, data.teamId);
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
