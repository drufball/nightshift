import { createServerFn } from '@tanstack/react-start';
import { readTeams, resolveCwd } from './teams';

export const getTeamView = createServerFn({ method: 'GET' })
  .inputValidator((data: { teamId: string }) => data)
  .handler(async ({ data }) => {
    const { getDbPath, openDb } = await import('~/db/index');
    const { getOpenProjectsByTeam } = await import('~/db/projects');
    const { getTeamMessages } = await import('~/db/messages');
    const { getSessionsByTeam } = await import('~/db/sessions');

    const cwd = await resolveCwd();
    const db = openDb(getDbPath(cwd));

    const teams = await readTeams(cwd);
    const team = teams.find((t) => t.name === data.teamId);
    if (!team) throw new Error(`Team not found: ${data.teamId}`);

    const projects = getOpenProjectsByTeam(db, data.teamId);
    const messages = getTeamMessages(db, data.teamId);
    const sessions = getSessionsByTeam(db, data.teamId);

    const agentNames = [
      team.lead,
      ...team.members.filter((m) => m !== team.lead),
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
    const { getDbPath, openDb } = await import('~/db/index');
    const { insertMessage } = await import('~/db/messages');

    const cwd = await resolveCwd();
    const db = openDb(getDbPath(cwd));

    insertMessage(db, data.teamId, 'user', data.content);

    const teams = await readTeams(cwd);
    const team = teams.find((t) => t.name === data.teamId);
    const leadName = team?.lead ?? 'project-lead';
    const reply = insertMessage(db, data.teamId, leadName, 'hello!');

    return { reply };
  });
