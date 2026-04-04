import { randomUUID } from 'node:crypto';
import type { Database } from './index';

export interface Project {
  id: string;
  name: string;
  team_id: string;
  branch: string;
  status: 'open' | 'merged';
  created_at: number;
}

export function insertProject(
  db: Database,
  name: string,
  teamId: string,
  branch: string,
): Project {
  const project: Project = {
    id: randomUUID(),
    name,
    team_id: teamId,
    branch,
    status: 'open',
    created_at: Date.now(),
  };
  db.prepare(
    'INSERT INTO projects (id, name, team_id, branch, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    project.id,
    project.name,
    project.team_id,
    project.branch,
    project.status,
    project.created_at,
  );
  return project;
}

export function getProjectsByTeam(db: Database, teamId: string): Project[] {
  return db
    .prepare(
      'SELECT * FROM projects WHERE team_id = ? ORDER BY created_at DESC',
    )
    .all(teamId) as Project[];
}

export function getOpenProjectsByTeam(db: Database, teamId: string): Project[] {
  return db
    .prepare(
      "SELECT * FROM projects WHERE team_id = ? AND status = 'open' ORDER BY created_at DESC",
    )
    .all(teamId) as Project[];
}

export function markProjectMerged(db: Database, id: string): void {
  db.prepare("UPDATE projects SET status = 'merged' WHERE id = ?").run(id);
}

export function branchExists(db: Database, branch: string): boolean {
  const row = db
    .prepare(
      "SELECT COUNT(*) as count FROM projects WHERE branch = ? AND status = 'open'",
    )
    .get(branch) as { count: number } | undefined;
  return (row?.count ?? 0) > 0;
}
