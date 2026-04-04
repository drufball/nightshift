import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { type Database, openDb } from './index';
import { getProjectMessages, getTeamMessages, insertMessage } from './messages';
import {
  branchExists,
  getOpenProjectsByTeam,
  getProjectsByTeam,
  insertProject,
  markProjectMerged,
} from './projects';
import { getSessionsByTeam, upsertSession } from './sessions';

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
