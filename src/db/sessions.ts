import { randomUUID } from 'node:crypto';
import type { Database } from './index';

export interface AgentSession {
  id: string;
  team_id: string;
  project_id: string | null;
  agent_name: string;
  status: 'idle' | 'working';
  status_text: string | null;
  updated_at: number;
}

export function upsertSession(
  db: Database,
  teamId: string,
  agentName: string,
  status: 'idle' | 'working',
  statusText?: string,
  projectId?: string,
): AgentSession {
  const existing = db
    .prepare(
      'SELECT * FROM agent_sessions WHERE team_id = ? AND agent_name = ? AND project_id IS ?',
    )
    .get(teamId, agentName, projectId ?? null) as AgentSession | undefined;

  if (existing) {
    db.prepare(
      'UPDATE agent_sessions SET status = ?, status_text = ?, updated_at = ? WHERE id = ?',
    ).run(status, statusText ?? null, Date.now(), existing.id);
    return {
      ...existing,
      status,
      status_text: statusText ?? null,
      updated_at: Date.now(),
    };
  }

  const session: AgentSession = {
    id: randomUUID(),
    team_id: teamId,
    project_id: projectId ?? null,
    agent_name: agentName,
    status,
    status_text: statusText ?? null,
    updated_at: Date.now(),
  };
  db.prepare(
    'INSERT INTO agent_sessions (id, team_id, project_id, agent_name, status, status_text, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    session.id,
    session.team_id,
    session.project_id,
    session.agent_name,
    session.status,
    session.status_text,
    session.updated_at,
  );
  return session;
}

export function getSessionsByTeam(
  db: Database,
  teamId: string,
  projectId?: string,
): AgentSession[] {
  if (projectId) {
    return db
      .prepare(
        'SELECT * FROM agent_sessions WHERE team_id = ? AND project_id = ?',
      )
      .all(teamId, projectId) as AgentSession[];
  }
  return db
    .prepare(
      'SELECT * FROM agent_sessions WHERE team_id = ? AND project_id IS NULL',
    )
    .all(teamId) as AgentSession[];
}
