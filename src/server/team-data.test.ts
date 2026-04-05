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
import { type Database, openDb } from '~/db/index';
import { getTeamMessages, insertMessage } from '~/db/messages';
import {
  parseMentions,
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

  it('returns valid agent names from a clean JSON response', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"next_responders":["alice","bob"]}' }],
    });
    const result = await runConversationJudge(fakeMsgs, baseTeam, [
      'alice',
      'bob',
    ]);
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
    const result = await runConversationJudge(fakeMsgs, baseTeam, ['alice']);
    expect(result).toEqual(['alice']);
  });

  it('throws on invalid JSON', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not json at all' }],
    });
    await expect(
      runConversationJudge(fakeMsgs, baseTeam, ['alice']),
    ).rejects.toThrow();
  });

  it('throws when next_responders key is missing', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"responders":["alice"]}' }],
    });
    await expect(
      runConversationJudge(fakeMsgs, baseTeam, ['alice']),
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
    const result = await runConversationJudge(fakeMsgs, baseTeam, [
      'alice',
      'bob',
    ]);
    expect(result).toEqual(['alice']);
  });

  it('returns [] when next_responders is empty', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"next_responders":[]}' }],
    });
    const result = await runConversationJudge(fakeMsgs, baseTeam, [
      'alice',
      'bob',
    ]);
    expect(result).toEqual([]);
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
});
