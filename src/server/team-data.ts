import { createServerFn } from '@tanstack/react-start';
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

export const sendTeamMessage = createServerFn({ method: 'POST' })
  .inputValidator((data: { teamId: string; content: string }) => data)
  .handler(async ({ data }) => {
    const { insertMessage } = await import('~/db/messages');
    const { runLeadAgent } = await import('./agent-runner');

    const [db, teams, cwd] = await Promise.all([
      getDb(),
      readTeams(await resolveCwd()),
      resolveCwd(),
    ]);

    insertMessage(db, data.teamId, 'user', data.content);

    const team = (teams as TeamMeta[]).find(
      (t: TeamMeta) => t.name === data.teamId,
    );
    const leadName = team?.lead ?? 'project-lead';

    const { getTeamMessages } = await import('~/db/messages');
    const recentMessages = getTeamMessages(db, data.teamId).slice(-20);

    const responseText = await runLeadAgent({
      db,
      teamId: data.teamId,
      agentName: leadName,
      userMessage: data.content,
      chatContext: recentMessages,
      cwd,
    });

    const reply = insertMessage(db, data.teamId, leadName, responseText);
    return { reply };
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
