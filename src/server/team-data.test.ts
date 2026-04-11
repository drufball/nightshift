import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { join } from 'node:path';
import { createGitRepo, createTmpDir, removeTmpDir } from '~/cli/test-helpers';
import { type Database, openDb } from '~/db/index';
import {
  getProjectMessages,
  getTeamMessages,
  insertMessage,
} from '~/db/messages';
import { getSession } from '~/db/sessions';
import {
  parseMentions,
  resolveProjectCwd,
  runConversationLoop,
} from './team-data';
import type { TeamMeta } from './teams';

// ---------------------------------------------------------------------------
// parseMentions
// ---------------------------------------------------------------------------

describe('parseMentions', () => {
  const names = ['alice', 'bob', 'tech-lead'];

  it('returns [] when content has no @mentions', () => {
    expect(parseMentions('hello everyone', names)).toEqual([]);
  });

  it('returns [] when mentioned name is not in knownNames', () => {
    expect(parseMentions('hey @charlie', names)).toEqual([]);
  });

  it('matches a single known @mention', () => {
    expect(parseMentions('hey @alice can you help?', names)).toEqual(['alice']);
  });

  it('matches multiple known @mentions', () => {
    expect(parseMentions('@alice and @bob please review', names)).toEqual([
      'alice',
      'bob',
    ]);
  });

  it('does not match a partial prefix — @alice does not match name "alicex"', () => {
    expect(parseMentions('@alice', ['alicex'])).toEqual([]);
  });

  it('does not let a short name match a longer hyphenated name (@tech does not match tech-lead)', () => {
    expect(parseMentions('ask @tech about this', ['tech'])).toEqual(['tech']);
    // Ensure @tech in content does NOT false-match the name 'tech-lead'
    // because 'tech-lead' is not a substring match for the exact word '@tech'
    expect(parseMentions('ask @tech about this', ['tech-lead'])).toEqual([]);
  });

  it('matches hyphenated names correctly', () => {
    expect(parseMentions('hey @tech-lead!', names)).toEqual(['tech-lead']);
  });
});

// ---------------------------------------------------------------------------
// runConversationLoop
// ---------------------------------------------------------------------------

describe('runConversationLoop', () => {
  let db: Database;

  const team: TeamMeta = {
    name: 'test-team',
    lead: 'alice',
    members: ['alice', 'bob'],
  };
  const teamMemberMeta = [
    { name: 'alice', description: 'Lead', isLead: true },
    { name: 'bob', description: 'Member', isLead: false },
  ];

  beforeEach(() => {
    db = openDb(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('breaks immediately when last message contains @user', async () => {
    const runAgentFn = mock(async () => '');
    insertMessage(db, 'test-team', 'user', '@user what do you think?');

    await runConversationLoop({
      db,
      teamId: 'test-team',
      team,
      cwd: '/tmp',
      teamMemberMeta,
      runAgentFn,
    });

    expect(runAgentFn).not.toHaveBeenCalled();
  });

  it('routes to team lead when user sends a message with no @mentions', async () => {
    // Lead responds with @user to stop cleanly
    const runAgentFn = mock(async () => '@user here is my answer');
    insertMessage(db, 'test-team', 'user', 'any thoughts?');

    await runConversationLoop({
      db,
      teamId: 'test-team',
      team,
      cwd: '/tmp',
      teamMemberMeta,
      runAgentFn,
    });

    expect(runAgentFn).toHaveBeenCalledTimes(1);
    const msgs = getTeamMessages(db, 'test-team');
    expect(msgs.some((m) => m.sender === 'alice')).toBe(true);
  });

  it('routes to @mentioned agents when user includes @mentions', async () => {
    // Bob responds with @user so the loop exits after one turn
    const runAgentFn = mock(async () => '@user done');
    insertMessage(db, 'test-team', 'user', 'hey @bob please help');

    await runConversationLoop({
      db,
      teamId: 'test-team',
      team,
      cwd: '/tmp',
      teamMemberMeta,
      runAgentFn,
    });

    expect(runAgentFn).toHaveBeenCalledTimes(1);
    const msgs = getTeamMessages(db, 'test-team');
    expect(msgs.some((m) => m.sender === 'bob')).toBe(true);
  });

  it('routes non-lead agent response to team lead', async () => {
    // Bob responds "done" (no mentions) → alice (lead) responds → @user stops loop
    let callCount = 0;
    const runAgentFn = mock(async () => {
      callCount++;
      return callCount === 1
        ? 'done' // bob's response — no @mentions, routes to lead
        : '@user looks good'; // alice's response — @user stops the loop
    });
    insertMessage(db, 'test-team', 'user', 'hey @bob please help');

    await runConversationLoop({
      db,
      teamId: 'test-team',
      team,
      cwd: '/tmp',
      teamMemberMeta,
      runAgentFn,
    });

    // bob ran first, then alice (lead) handled bob's message
    expect(runAgentFn).toHaveBeenCalledTimes(2);
    const msgs = getTeamMessages(db, 'test-team');
    expect(msgs.some((m) => m.sender === 'bob')).toBe(true);
    expect(msgs.some((m) => m.sender === 'alice')).toBe(true);
  });

  it('stops when team lead sends a message with no @mentions', async () => {
    // Alice (lead) responds with no @mentions → assumed to be for user, stop
    const runAgentFn = mock(async () => 'here is my answer');
    insertMessage(db, 'test-team', 'user', 'any thoughts?');

    await runConversationLoop({
      db,
      teamId: 'test-team',
      team,
      cwd: '/tmp',
      teamMemberMeta,
      runAgentFn,
    });

    // Lead ran once and stopped — no second turn
    expect(runAgentFn).toHaveBeenCalledTimes(1);
    const msgs = getTeamMessages(db, 'test-team');
    expect(msgs.some((m) => m.sender === 'alice')).toBe(true);
  });

  it('scopes messages to projectId when provided', async () => {
    const projectId = 'proj-123';
    const runAgentFn = mock(async () => 'done, @user check this');
    // Insert a message in the project scope (not team scope)
    insertMessage(
      db,
      'test-team',
      'user',
      'hey @alice project work',
      projectId,
    );

    await runConversationLoop({
      db,
      teamId: 'test-team',
      team,
      cwd: '/tmp',
      teamMemberMeta,
      projectId,
      runAgentFn,
    });

    // alice ran and her message was inserted into the project scope
    expect(runAgentFn).toHaveBeenCalledTimes(1);
    const projectMsgs = getProjectMessages(db, projectId);
    expect(projectMsgs.some((m) => m.sender === 'alice')).toBe(true);
    // Team-scoped messages table should not have alice's message
    const teamMsgs = getTeamMessages(db, 'test-team');
    expect(teamMsgs.some((m) => m.sender === 'alice')).toBe(false);
  });

  it('breaks immediately when projectId-scoped last message contains @user', async () => {
    const projectId = 'proj-456';
    const runAgentFn = mock(async () => '');
    // Insert a message that already mentions @user — loop should exit without running any agent
    insertMessage(
      db,
      'test-team',
      'user',
      '@user what do you think?',
      projectId,
    );

    await runConversationLoop({
      db,
      teamId: 'test-team',
      team,
      cwd: '/tmp',
      teamMemberMeta,
      projectId,
      runAgentFn,
    });

    expect(runAgentFn).not.toHaveBeenCalled();
  });

  it('resets session to idle when the agent throws an error', async () => {
    const { upsertSession } = await import('~/db/sessions');
    // Pre-create a 'working' session for alice to simulate a stuck state
    upsertSession(db, 'test-team', 'alice', 'working', 'doing stuff');

    const runAgentFn = mock(async () => {
      throw new Error('SDK crashed');
    });
    insertMessage(db, 'test-team', 'user', 'hey @alice help');

    await runConversationLoop({
      db,
      teamId: 'test-team',
      team,
      cwd: '/tmp',
      teamMemberMeta,
      runAgentFn,
    });

    // After the error the loop should have called upsertSession with 'idle'
    const session = getSession(db, 'test-team', 'alice');
    expect(session?.status).toBe('idle');
  });

  it('resets project-scoped session to idle when the agent throws', async () => {
    const { upsertSession } = await import('~/db/sessions');
    const projectId = 'proj-err';
    upsertSession(
      db,
      'test-team',
      'alice',
      'working',
      'doing stuff',
      projectId,
    );

    const runAgentFn = mock(async () => {
      throw new Error('SDK crashed');
    });
    insertMessage(db, 'test-team', 'user', 'hey @alice help', projectId);

    await runConversationLoop({
      db,
      teamId: 'test-team',
      team,
      cwd: '/tmp',
      teamMemberMeta,
      projectId,
      runAgentFn,
    });

    const session = getSession(db, 'test-team', 'alice', projectId);
    expect(session?.status).toBe('idle');
  });

  it('passes projectBranch to the agent when provided', async () => {
    const projectId = 'proj-branch';
    // biome-ignore lint/suspicious/noExplicitAny: test capture
    let capturedOpts: Record<string, any> | undefined;
    // biome-ignore lint/suspicious/noExplicitAny: test capture
    const runAgentFn = mock(async (opts: Record<string, any>) => {
      capturedOpts = opts;
      return '@user done';
    });
    insertMessage(
      db,
      'test-team',
      'user',
      'hey @alice work on branch',
      projectId,
    );

    await runConversationLoop({
      db,
      teamId: 'test-team',
      team,
      cwd: '/tmp',
      teamMemberMeta,
      projectId,
      projectBranch: 'feature-xyz',
      runAgentFn,
    });

    expect(capturedOpts?.projectBranch).toBe('feature-xyz');
  });

  it('passes worktreeDir to the agent when provided', async () => {
    const projectId = 'proj-worktree';
    // biome-ignore lint/suspicious/noExplicitAny: test capture
    let capturedOpts: Record<string, any> | undefined;
    // biome-ignore lint/suspicious/noExplicitAny: test capture
    const runAgentFn = mock(async (opts: Record<string, any>) => {
      capturedOpts = opts;
      return '@user done';
    });
    insertMessage(db, 'test-team', 'user', 'hey @alice work here', projectId);

    await runConversationLoop({
      db,
      teamId: 'test-team',
      team,
      cwd: '/repo-root',
      teamMemberMeta,
      projectId,
      worktreeDir: '/repo-root/.nightshift/worktrees/my-feature',
      runAgentFn,
    });

    expect(capturedOpts?.cwd).toBe('/repo-root');
    expect(capturedOpts?.worktreeDir).toBe(
      '/repo-root/.nightshift/worktrees/my-feature',
    );
  });

  it('teamFolder is an absolute path based on cwd', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test capture
    let capturedOpts: Record<string, any> | undefined;
    // biome-ignore lint/suspicious/noExplicitAny: test capture
    const runAgentFn = mock(async (opts: Record<string, any>) => {
      capturedOpts = opts;
      return '@user done';
    });
    insertMessage(db, 'test-team', 'user', 'any thoughts?');

    await runConversationLoop({
      db,
      teamId: 'test-team',
      team,
      cwd: '/repo-root',
      teamMemberMeta,
      runAgentFn,
    });

    expect(capturedOpts?.teamFolder).toBe(
      '/repo-root/.nightshift/teams/test-team',
    );
  });
});

// ---------------------------------------------------------------------------
// resolveProjectCwd
// ---------------------------------------------------------------------------

describe('resolveProjectCwd', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    await createGitRepo(tmpDir);
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it('returns git root when no branch is given', async () => {
    const result = await resolveProjectCwd(tmpDir, undefined);
    expect(result).toBe(tmpDir);
  });

  it('returns the worktree path when the branch has a worktree', async () => {
    const { execSync } = await import('node:child_process');
    const { mkdir, realpath } = await import('node:fs/promises');
    const worktreeDir = join(tmpDir, '.nightshift', 'worktrees', 'my-feature');
    await mkdir(join(tmpDir, '.nightshift', 'worktrees'), { recursive: true });
    execSync('git branch feature-branch', { cwd: tmpDir, stdio: 'pipe' });
    execSync(`git worktree add "${worktreeDir}" feature-branch`, {
      cwd: tmpDir,
      stdio: 'pipe',
    });

    const result = await resolveProjectCwd(tmpDir, 'feature-branch');
    // Normalize both paths to resolve macOS /var → /private/var symlink
    expect(await realpath(result)).toBe(await realpath(worktreeDir));
  });

  it('falls back to git root when branch has no worktree', async () => {
    const { execSync } = await import('node:child_process');
    execSync('git checkout -b no-worktree-branch', {
      cwd: tmpDir,
      stdio: 'pipe',
    });
    execSync('git checkout -', { cwd: tmpDir, stdio: 'pipe' });

    const result = await resolveProjectCwd(tmpDir, 'no-worktree-branch');
    expect(result).toBe(tmpDir);
  });
});
