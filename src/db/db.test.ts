import { Database as BunDatabase } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { type Database, openDb } from './index';
import { getProjectMessages, getTeamMessages, insertMessage } from './messages';
import {
  branchExists,
  getOpenProjectsByName,
  getOpenProjectsByTeam,
  getProjectsByTeam,
  insertProject,
  markProjectMerged,
} from './projects';
import { CREATE_TABLES } from './schema';
import {
  getSession,
  getSessionsByTeam,
  resetStuckSessions,
  setSessionSdkId,
  upsertSession,
} from './sessions';

let db: Database;

beforeEach(() => {
  db = openDb(':memory:');
});

afterEach(() => {
  db.close();
});

describe('projects', () => {
  it('inserts a project and retrieves it by team', () => {
    const p = insertProject(db, 'my-feature', 'feature-team', 'my-feature');
    expect(p.id).toBeTruthy();
    expect(p.name).toBe('my-feature');
    expect(p.status).toBe('open');

    const projects = getProjectsByTeam(db, 'feature-team');
    expect(projects).toHaveLength(1);
    expect(projects[0].branch).toBe('my-feature');
  });

  it('allows duplicate names (different ids)', () => {
    insertProject(db, 'my-feature', 'feature-team', 'my-feature');
    insertProject(db, 'my-feature', 'feature-team', 'my-feature-a1b2');
    const projects = getProjectsByTeam(db, 'feature-team');
    expect(projects).toHaveLength(2);
    expect(projects[0].id).not.toBe(projects[1].id);
  });

  it('marks a project merged and excludes it from open list', () => {
    const p = insertProject(db, 'fix', 'feature-team', 'fix');
    markProjectMerged(db, p.id);

    const open = getOpenProjectsByTeam(db, 'feature-team');
    expect(open).toHaveLength(0);

    const all = getProjectsByTeam(db, 'feature-team');
    expect(all[0].status).toBe('merged');
  });

  it('detects open branch conflicts', () => {
    insertProject(db, 'feat', 'feature-team', 'feat');
    expect(branchExists(db, 'feat')).toBe(true);
    expect(branchExists(db, 'other')).toBe(false);
  });

  it('does not flag merged branches as conflicting', () => {
    const p = insertProject(db, 'feat', 'feature-team', 'feat');
    markProjectMerged(db, p.id);
    expect(branchExists(db, 'feat')).toBe(false);
  });

  it('getOpenProjectsByName returns only open projects with the given name', () => {
    const p1 = insertProject(db, 'my-feature', 'team-a', 'my-feature');
    const p2 = insertProject(db, 'my-feature', 'team-b', 'my-feature-a1b2');
    insertProject(db, 'other', 'team-a', 'other');
    markProjectMerged(db, p2.id);

    const result = getOpenProjectsByName(db, 'my-feature');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(p1.id);
  });

  it('getOpenProjectsByName returns empty array when no open projects match', () => {
    const p = insertProject(db, 'my-feature', 'team-a', 'my-feature');
    markProjectMerged(db, p.id);

    const result = getOpenProjectsByName(db, 'my-feature');
    expect(result).toHaveLength(0);
  });
});

describe('messages', () => {
  it('inserts and retrieves team messages (no project)', () => {
    insertMessage(db, 'feature-team', 'user', 'hello team');
    insertMessage(db, 'feature-team', 'project-lead', 'hello!');

    const msgs = getTeamMessages(db, 'feature-team');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].sender).toBe('user');
    expect(msgs[1].content).toBe('hello!');
    expect(msgs[0].project_id).toBeNull();
  });

  it('retrieves project messages separately from team messages', () => {
    insertMessage(db, 'feature-team', 'user', 'team msg');
    insertMessage(db, 'feature-team', 'user', 'project msg', 'proj-123');

    const teamMsgs = getTeamMessages(db, 'feature-team');
    expect(teamMsgs).toHaveLength(1);
    expect(teamMsgs[0].content).toBe('team msg');

    const projMsgs = getProjectMessages(db, 'proj-123');
    expect(projMsgs).toHaveLength(1);
    expect(projMsgs[0].content).toBe('project msg');
  });

  it('stores and parses mentions', () => {
    insertMessage(db, 'feature-team', 'user', 'hey @tech-lead', undefined, [
      'tech-lead',
    ]);
    const msgs = getTeamMessages(db, 'feature-team');
    expect(JSON.parse(msgs[0].mentions)).toEqual(['tech-lead']);
  });
});

describe('agent_sessions', () => {
  it('inserts a session and retrieves it', () => {
    upsertSession(db, 'feature-team', 'project-lead', 'idle');
    const sessions = getSessionsByTeam(db, 'feature-team');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].agent_name).toBe('project-lead');
    expect(sessions[0].status).toBe('idle');
  });

  it('upserts — updates existing session instead of inserting duplicate', () => {
    upsertSession(db, 'feature-team', 'tech-lead', 'idle');
    upsertSession(db, 'feature-team', 'tech-lead', 'working', 'writing tests');

    const sessions = getSessionsByTeam(db, 'feature-team');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('working');
    expect(sessions[0].status_text).toBe('writing tests');
  });

  it('getSession returns the matching session', () => {
    upsertSession(db, 'feature-team', 'project-lead', 'working', 'thinking');
    const session = getSession(db, 'feature-team', 'project-lead');
    expect(session).not.toBeNull();
    expect(session?.agent_name).toBe('project-lead');
    expect(session?.status).toBe('working');
  });

  it('getSession returns null when no matching session', () => {
    const session = getSession(db, 'feature-team', 'nonexistent');
    expect(session).toBeNull();
  });

  it('setSessionSdkId stores and retrieves the sdk_session_id', () => {
    upsertSession(db, 'feature-team', 'project-lead', 'working');
    setSessionSdkId(db, 'feature-team', 'project-lead', 'sdk-abc-123');
    const session = getSession(db, 'feature-team', 'project-lead');
    expect(session?.sdk_session_id).toBe('sdk-abc-123');
  });

  it('setSessionSdkId does not clear sdk_session_id on subsequent upsertSession calls', () => {
    upsertSession(db, 'feature-team', 'project-lead', 'working');
    setSessionSdkId(db, 'feature-team', 'project-lead', 'sdk-abc-123');
    upsertSession(db, 'feature-team', 'project-lead', 'idle');
    const session = getSession(db, 'feature-team', 'project-lead');
    expect(session?.sdk_session_id).toBe('sdk-abc-123');
    expect(session?.status).toBe('idle');
  });

  it('scopes sessions to project when projectId provided', () => {
    upsertSession(db, 'feature-team', 'tech-lead', 'idle');
    upsertSession(
      db,
      'feature-team',
      'tech-lead',
      'working',
      'coding',
      'proj-123',
    );

    const teamSessions = getSessionsByTeam(db, 'feature-team');
    expect(teamSessions).toHaveLength(1);
    expect(teamSessions[0].status).toBe('idle');

    const projSessions = getSessionsByTeam(db, 'feature-team', 'proj-123');
    expect(projSessions).toHaveLength(1);
    expect(projSessions[0].status).toBe('working');
  });
});

// ---------------------------------------------------------------------------
// resetStuckSessions
// ---------------------------------------------------------------------------

describe('resetStuckSessions', () => {
  it('resets a working session back to idle', () => {
    upsertSession(db, 'feature-team', 'tech-lead', 'working', 'doing stuff');
    resetStuckSessions(db, 'feature-team');

    const session = getSession(db, 'feature-team', 'tech-lead');
    expect(session?.status).toBe('idle');
  });

  it('leaves already-idle sessions unchanged', () => {
    upsertSession(db, 'feature-team', 'tech-lead', 'idle');
    resetStuckSessions(db, 'feature-team');

    const sessions = getSessionsByTeam(db, 'feature-team');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('idle');
  });

  it('resets multiple working sessions in the same team', () => {
    upsertSession(db, 'feature-team', 'agent-a', 'working');
    upsertSession(db, 'feature-team', 'agent-b', 'working');
    upsertSession(db, 'feature-team', 'agent-c', 'idle');

    resetStuckSessions(db, 'feature-team');

    const sessions = getSessionsByTeam(db, 'feature-team');
    for (const s of sessions) {
      expect(s.status).toBe('idle');
    }
  });

  it('only resets sessions in the specified team', () => {
    upsertSession(db, 'team-a', 'agent-x', 'working');
    upsertSession(db, 'team-b', 'agent-y', 'working');

    resetStuckSessions(db, 'team-a');

    expect(getSession(db, 'team-a', 'agent-x')?.status).toBe('idle');
    expect(getSession(db, 'team-b', 'agent-y')?.status).toBe('working');
  });

  it('scopes reset to the specified projectId when provided', () => {
    upsertSession(db, 'feature-team', 'tech-lead', 'working'); // team-scoped
    upsertSession(
      db,
      'feature-team',
      'tech-lead',
      'working',
      'coding',
      'proj-123',
    ); // project-scoped

    resetStuckSessions(db, 'feature-team', 'proj-123');

    expect(getSession(db, 'feature-team', 'tech-lead')?.status).toBe('working');
    expect(
      getSession(db, 'feature-team', 'tech-lead', 'proj-123')?.status,
    ).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// openDb migration path — pre-existing DB without sdk_session_id column
// ---------------------------------------------------------------------------

describe('openDb migration', () => {
  it('adds sdk_session_id column to a pre-migration DB and keeps existing data intact', () => {
    // Build an old-schema DB without the sdk_session_id column
    const oldDb = new BunDatabase(':memory:');
    oldDb.exec('PRAGMA journal_mode = WAL;');
    // Create tables using the same DDL but without sdk_session_id
    oldDb.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        team_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        project_id TEXT,
        sender TEXT NOT NULL,
        content TEXT NOT NULL,
        mentions TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        project_id TEXT,
        agent_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        status_text TEXT,
        updated_at INTEGER NOT NULL
      );
    `);
    // Insert a row before the migration runs
    oldDb.exec(
      "INSERT INTO agent_sessions (id, team_id, project_id, agent_name, status, status_text, updated_at) VALUES ('s1', 'team-a', NULL, 'tech-lead', 'idle', NULL, 1)",
    );

    // Simulate the migration by running the same try/catch block openDb uses
    try {
      oldDb.exec('ALTER TABLE agent_sessions ADD COLUMN sdk_session_id TEXT;');
    } catch {
      // already exists — ignore
    }

    // Verify the column is present and the pre-existing row still exists
    const row = oldDb
      .prepare('SELECT * FROM agent_sessions WHERE id = ?')
      .get('s1') as { agent_name: string; sdk_session_id: string | null };
    expect(row.agent_name).toBe('tech-lead');
    expect(row.sdk_session_id).toBeNull();

    oldDb.close();
  });

  it('openDb on a fresh :memory: DB exposes sdk_session_id via getSession/setSessionSdkId', () => {
    const freshDb = openDb(':memory:');
    upsertSession(freshDb, 'team-x', 'agent-1', 'idle');
    setSessionSdkId(freshDb, 'team-x', 'agent-1', 'sdk-xyz');
    const session = getSession(freshDb, 'team-x', 'agent-1');
    expect(session?.sdk_session_id).toBe('sdk-xyz');
    freshDb.close();
  });

  it('openDb is idempotent — calling it twice on the same :memory: path does not throw', () => {
    // A second call to openDb(:memory:) creates an independent DB — both should work
    const db1 = openDb(':memory:');
    const db2 = openDb(':memory:');
    upsertSession(db1, 'team-1', 'a', 'idle');
    upsertSession(db2, 'team-2', 'b', 'working');
    expect(getSession(db1, 'team-1', 'a')?.status).toBe('idle');
    expect(getSession(db2, 'team-2', 'b')?.status).toBe('working');
    db1.close();
    db2.close();
  });
});
