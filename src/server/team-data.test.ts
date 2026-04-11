import { mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that trigger the mocked
// modules. Bun hoists mock.module() calls above all other imports.
// ---------------------------------------------------------------------------

// Mock @anthropic-ai/sdk so runConversationJudge tests don't hit the real API.
// We do NOT mock ./agent-runner at module level — instead runConversationLoop
// accepts an injectable runAgentFn so individual tests can pass a mock directly.
const mockCreate = mock(async (_opts: unknown) => ({
  content: [{ type: 'text', text: '{"next_responders":[]}' }],
}));

mock.module('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

// ---------------------------------------------------------------------------
// Regular imports (after mocks are registered)
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
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
  runConversationJudge,
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
// runConversationJudge
// ---------------------------------------------------------------------------

const baseTeam: TeamMeta = {
  name: 'test-team',
  lead: 'alice',
  members: ['alice', 'bob'],
};

const fakeMsgs = [
  {
    id: '1',
    team_id: 'test-team',
    project_id: null,
    sender: 'user',
    content: 'Hello team',
    mentions: '[]',
    created_at: Date.now(),
  },
];

describe('runConversationJudge', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  const judgePrompt = 'You are a routing judge.';

  it('returns valid agent names from a clean JSON response', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"next_responders":["alice","bob"]}' }],
    });
    const result = await runConversationJudge(
      fakeMsgs,
      baseTeam,
      ['alice', 'bob'],
      judgePrompt,
    );
    expect(result).toEqual(['alice', 'bob']);
  });

  it('strips markdown code fences before parsing', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: '```json\n{"next_responders":["alice"]}\n```',
        },
      ],
    });
    const result = await runConversationJudge(
      fakeMsgs,
      baseTeam,
      ['alice'],
      judgePrompt,
    );
    expect(result).toEqual(['alice']);
  });

  it('throws on invalid JSON', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not json at all' }],
    });
    await expect(
      runConversationJudge(fakeMsgs, baseTeam, ['alice'], judgePrompt),
    ).rejects.toThrow();
  });

  it('throws when next_responders key is missing', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"responders":["alice"]}' }],
    });
    await expect(
      runConversationJudge(fakeMsgs, baseTeam, ['alice'], judgePrompt),
    ).rejects.toThrow('unexpected shape');
  });

  it('filters out unknown agent names', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: '{"next_responders":["alice","phantom-agent"]}',
        },
      ],
    });
    const result = await runConversationJudge(
      fakeMsgs,
      baseTeam,
      ['alice', 'bob'],
      judgePrompt,
    );
    expect(result).toEqual(['alice']);
  });

  it('returns [] when next_responders is empty', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"next_responders":[]}' }],
    });
    const result = await runConversationJudge(
      fakeMsgs,
      baseTeam,
      ['alice', 'bob'],
      judgePrompt,
    );
    expect(result).toEqual([]);
  });

  it('passes the system prompt to the API', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"next_responders":[]}' }],
    });
    await runConversationJudge(fakeMsgs, baseTeam, ['alice'], 'custom prompt');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ system: 'custom prompt' }),
    );
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
    mockCreate.mockReset();
    // Default judge: return no responders so the loop exits cleanly
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"next_responders":[]}' }],
    });
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

  it('routes to @mentioned agents and skips the judge for that turn', async () => {
    // Alice replies with @user so the loop exits immediately — no second judge call
    const runAgentFn = mock(async () => 'done, @user please review');
    insertMessage(db, 'test-team', 'user', 'hey @alice please help');

    await runConversationLoop({
      db,
      teamId: 'test-team',
      team,
      cwd: '/tmp',
      teamMemberMeta,
      runAgentFn,
    });

    expect(runAgentFn).toHaveBeenCalledTimes(1);
    // Alice's response was inserted into the DB — confirming she was the one routed to
    const msgs = getTeamMessages(db, 'test-team');
    expect(msgs.some((m) => m.sender === 'alice')).toBe(true);
    // Judge should not have been called — @mention was explicit and alice handed back to user
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('stops loop after user @mention agents respond, even when agent does not reply @user', async () => {
    // Alice responds without @user or any further @mention — loop must still stop
    const runAgentFn = mock(async () => 'on it');
    insertMessage(db, 'test-team', 'user', 'hey @alice please help');

    await runConversationLoop({
      db,
      teamId: 'test-team',
      team,
      cwd: '/tmp',
      teamMemberMeta,
      runAgentFn,
    });

    expect(runAgentFn).toHaveBeenCalledTimes(1);
    // Judge must NOT be called — explicit user @mention trumps judge routing
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('exits when judge returns no responders', async () => {
    const runAgentFn = mock(async () => '');
    insertMessage(db, 'test-team', 'user', 'any thoughts?');

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

  it('falls back to lead when judge throws, unless lead already spoke', async () => {
    mockCreate.mockRejectedValue(new Error('API error'));
    const runAgentFn = mock(async () => '');
    insertMessage(db, 'test-team', 'user', 'help please');

    await runConversationLoop({
      db,
      teamId: 'test-team',
      team,
      cwd: '/tmp',
      teamMemberMeta,
      runAgentFn,
    });

    expect(runAgentFn).toHaveBeenCalledTimes(1);
    // Alice (lead) was the fallback responder — her message appears in the DB
    const msgs = getTeamMessages(db, 'test-team');
    expect(msgs.some((m) => m.sender === 'alice')).toBe(true);
  });

  it('does not fall back to lead when lead is the last speaker', async () => {
    mockCreate.mockRejectedValue(new Error('API error'));
    const runAgentFn = mock(async () => '');
    // Alice (lead) is the last sender — fallback should be skipped
    insertMessage(db, 'test-team', 'alice', 'I already replied');

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

  it('stops at MAX_AGENT_TURNS even when judge returns more agents', async () => {
    const manyAgents = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'];
    const bigTeam: TeamMeta = {
      name: 'big-team',
      lead: 'a1',
      members: manyAgents,
    };
    const bigTeamMeta = manyAgents.map((name, i) => ({
      name,
      description: `Agent ${i + 1}`,
      isLead: name === 'a1',
    }));
    const runAgentFn = mock(async () => '');

    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: `{"next_responders":${JSON.stringify(manyAgents)}}`,
        },
      ],
    });
    insertMessage(db, 'big-team', 'user', 'everyone respond');

    await runConversationLoop({
      db,
      teamId: 'big-team',
      team: bigTeam,
      cwd: '/tmp',
      teamMemberMeta: bigTeamMeta,
      runAgentFn,
    });

    expect(runAgentFn).toHaveBeenCalledTimes(6);
  });

  it('does not run the same agent twice across loop iterations', async () => {
    // Judge returns alice on two consecutive calls; alice only runs the first time
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"next_responders":["alice"]}' }],
    });
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"next_responders":["alice"]}' }],
    });
    // alice returns '' (no @user / no @mentions) so the loop goes back to the judge
    const runAgentFn = mock(async () => '');
    insertMessage(db, 'test-team', 'user', 'help please');

    await runConversationLoop({
      db,
      teamId: 'test-team',
      team,
      cwd: '/tmp',
      teamMemberMeta,
      runAgentFn,
    });

    // alice ran once; second judge call returned alice again but respondedAgents blocked her
    expect(runAgentFn).toHaveBeenCalledTimes(1);
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
