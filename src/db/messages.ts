import { randomUUID } from 'node:crypto';
import type { Database } from './index';

export interface Message {
  id: string;
  team_id: string;
  project_id: string | null;
  sender: string;
  content: string;
  mentions: string; // JSON array
  created_at: number;
}

export function insertMessage(
  db: Database,
  teamId: string,
  sender: string,
  content: string,
  projectId?: string,
  mentions: string[] = [],
): Message {
  const message: Message = {
    id: randomUUID(),
    team_id: teamId,
    project_id: projectId ?? null,
    sender,
    content,
    mentions: JSON.stringify(mentions),
    created_at: Date.now(),
  };
  db.prepare(
    'INSERT INTO messages (id, team_id, project_id, sender, content, mentions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    message.id,
    message.team_id,
    message.project_id,
    message.sender,
    message.content,
    message.mentions,
    message.created_at,
  );
  return message;
}

export function getTeamMessages(db: Database, teamId: string): Message[] {
  return db
    .prepare(
      'SELECT * FROM messages WHERE team_id = ? AND project_id IS NULL ORDER BY created_at ASC',
    )
    .all(teamId) as Message[];
}

export function getProjectMessages(db: Database, projectId: string): Message[] {
  return db
    .prepare(
      'SELECT * FROM messages WHERE project_id = ? ORDER BY created_at ASC',
    )
    .all(projectId) as Message[];
}
