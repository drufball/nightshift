import { mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Module mocks — must come before any other imports so Bun can hoist them.
// ---------------------------------------------------------------------------

// Mock @anthropic-ai/claude-agent-sdk used by runAgent.
// We type the generator as AsyncGenerator<unknown> so mockReturnValue calls
// with typed streams don't fail the type checker.
const mockQuery = mock(
  (): AsyncGenerator<unknown> => (async function* () {})(),
);

mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
}));

// Mock node:fs/promises so readAgentMeta and loadPromptTemplate don't hit disk
const mockReadFile = mock(async (path: string, _enc: string) => {
  if (path.endsWith('.spec.md')) {
    // Return a minimal template for prompt-spec files
    return [
      '${agentPrompt}',
      '',
      '---',
      '',
      '## Your Team',
      '',
      'Team: **${teamName}**',
      'Team folder: `${teamFolder}`',
      '',
      '${memberLines}',
      '',
      'Mention `@user` when you need input from the human user before continuing.',
      '',
      '---',
      '',
      '## Recent Team Chat',
      '',
      '${chatSection}',
    ].join('\n');
  }
  return `---
name: test-agent
description: A test agent
---
You are a test agent.`;
});

mock.module('node:fs/promises', () => ({
  readFile: mockReadFile,
}));

// ---------------------------------------------------------------------------
// Regular imports
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Message } from '~/db/messages';
import {
  buildSystemPrompt,
  formatToolStatus,
  loadPromptTemplate,
  parseAgentMeta,
  runAgent,
  selectPromptTemplate,
  shouldFlushThinking,
} from './agent-runner';

// ---------------------------------------------------------------------------
// parseAgentMeta
// ---------------------------------------------------------------------------

describe('parseAgentMeta', () => {
  it('extracts name, description, and body from full frontmatter', () => {
    const content = `---
name: tech-lead
description: Handles technical architecture
---
You are a senior engineer.`;

    const meta = parseAgentMeta(content);
    expect(meta.name).toBe('tech-lead');
    expect(meta.description).toBe('Handles technical architecture');
    expect(meta.systemPrompt).toBe('You are a senior engineer.');
  });

  it('returns empty name and description when frontmatter is absent', () => {
    const content = 'Just a plain prompt with no frontmatter.';
    const meta = parseAgentMeta(content);
    expect(meta.name).toBe('');
    expect(meta.description).toBe('');
    expect(meta.systemPrompt).toBe('Just a plain prompt with no frontmatter.');
  });

  it('returns empty string for missing name field', () => {
    const content = `---
description: Does stuff
---
Prompt body.`;
    const meta = parseAgentMeta(content);
    expect(meta.name).toBe('');
    expect(meta.description).toBe('Does stuff');
  });

  it('returns empty string for missing description field', () => {
    const content = `---
name: my-agent
---
Prompt body.`;
    const meta = parseAgentMeta(content);
    expect(meta.name).toBe('my-agent');
    expect(meta.description).toBe('');
  });

  it('preserves multi-line system prompt body', () => {
    const content = `---
name: agent
description: desc
---
Line one.
Line two.
Line three.`;
    const meta = parseAgentMeta(content);
    expect(meta.systemPrompt).toBe('Line one.\nLine two.\nLine three.');
  });
});

// ---------------------------------------------------------------------------
// formatToolStatus
// ---------------------------------------------------------------------------

describe('formatToolStatus', () => {
  it('returns just the tool name when input is empty', () => {
    expect(formatToolStatus('Read', {})).toBe('Read');
  });

  it('includes key: value pairs from input', () => {
    expect(formatToolStatus('Read', { file_path: '/foo/bar.ts' })).toBe(
      'Read file_path: /foo/bar.ts',
    );
  });

  it('truncates string values longer than 100 chars', () => {
    const long = 'a'.repeat(120);
    const result = formatToolStatus('Write', { content: long });
    expect(result).toContain('…');
    expect(result.length).toBeLessThan(200);
  });

  it('filters out null, undefined, and empty string values', () => {
    const result = formatToolStatus('Bash', {
      command: 'ls',
      description: '',
      timeout: null as unknown as string,
    });
    expect(result).toBe('Bash command: ls');
  });

  it('summarises arrays up to 3 items with overflow count', () => {
    const result = formatToolStatus('Grep', {
      patterns: ['a', 'b', 'c', 'd', 'e'],
    });
    expect(result).toContain('a, b, c');
    expect(result).toContain('(+2)');
  });

  it('joins multiple params with ". "', () => {
    const result = formatToolStatus('Edit', {
      file_path: '/foo.ts',
      old_string: 'x',
    });
    expect(result).toBe('Edit file_path: /foo.ts. old_string: x');
  });
});

// ---------------------------------------------------------------------------
// shouldFlushThinking
// ---------------------------------------------------------------------------

describe('shouldFlushThinking', () => {
  it('returns false when buffer has grown less than 150 chars since last flush', () => {
    expect(shouldFlushThinking(100, 0)).toBe(false);
  });

  it('returns true at exactly 150 chars of new content', () => {
    expect(shouldFlushThinking(150, 0)).toBe(true);
  });

  it('returns true when buffer has grown more than 150 chars', () => {
    expect(shouldFlushThinking(200, 0)).toBe(true);
  });

  it('uses lastFlushAt as the baseline, not zero', () => {
    expect(shouldFlushThinking(300, 200)).toBe(false); // only 100 new chars
    expect(shouldFlushThinking(351, 200)).toBe(true); // 151 new chars
  });
});

// ---------------------------------------------------------------------------
// selectPromptTemplate
// ---------------------------------------------------------------------------

describe('selectPromptTemplate', () => {
  it('selects team-member template for non-lead without project branch', () => {
    expect(selectPromptTemplate(false, undefined)).toBe(
      'team-member-prompt.spec.md',
    );
  });

  it('selects team-lead template for lead without project branch', () => {
    expect(selectPromptTemplate(true, undefined)).toBe(
      'team-lead-prompt.spec.md',
    );
  });

  it('selects project-member template for non-lead with project branch', () => {
    expect(selectPromptTemplate(false, 'feature/login')).toBe(
      'project-member-prompt.spec.md',
    );
  });

  it('selects project-lead template for lead with project branch', () => {
    expect(selectPromptTemplate(true, 'feature/login')).toBe(
      'project-lead-prompt.spec.md',
    );
  });
});

// ---------------------------------------------------------------------------
// loadPromptTemplate
// ---------------------------------------------------------------------------

describe('loadPromptTemplate', () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockReadFile.mockImplementation(async (path: string) => {
      return `template-content-for:${path}`;
    });
  });

  it('reads the correct spec file for team-member context', async () => {
    const content = await loadPromptTemplate(false, undefined);
    expect(content).toContain('team-member-prompt.spec.md');
  });

  it('reads the correct spec file for project-lead context', async () => {
    const content = await loadPromptTemplate(true, 'feature/branch');
    expect(content).toContain('project-lead-prompt.spec.md');
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

function makeMsg(
  sender: string,
  content: string,
  overrides: Partial<Message> = {},
): Message {
  return {
    id: 'msg-1',
    team_id: 'team',
    project_id: null,
    sender,
    content,
    mentions: '[]',
    created_at: Date.now(),
    ...overrides,
  };
}

// A minimal team template for use in buildSystemPrompt tests.
const TEAM_TEMPLATE = [
  '${agentPrompt}',
  '',
  '---',
  '',
  '## Your Team',
  '',
  'Team: **${teamName}**',
  'Team folder: `${teamFolder}`',
  '',
  'Members — use @name to mention a teammate and ensure they respond next:',
  '',
  '${memberLines}',
  '',
  'Mention `@user` when you need input from the human user before continuing.',
  '',
  '---',
  '',
  '## Recent Team Chat',
  '',
  'The following messages were recently posted in the team chat:',
  '',
  '${chatSection}',
].join('\n');

// A minimal project template — adds the project branch line and "Project Chat" label.
const PROJECT_TEMPLATE = [
  '${agentPrompt}',
  '',
  '---',
  '',
  '## Your Team',
  '',
  'Team: **${teamName}**',
  'Team folder: `${teamFolder}`',
  'Current project branch: `${projectBranch}`',
  '',
  '${memberLines}',
  '',
  'Mention `@user` when you need input from the human user before continuing.',
  '',
  '---',
  '',
  '## Recent Project Chat',
  '',
  'The following messages were recently posted in the project chat:',
  '',
  '${chatSection}',
].join('\n');

describe('buildSystemPrompt', () => {
  const teamMembers = [
    { name: 'alice', description: 'Lead engineer', isLead: true },
    { name: 'bob', description: 'Backend dev', isLead: false },
  ];

  it('includes the agent base prompt', () => {
    const result = buildSystemPrompt(
      TEAM_TEMPLATE,
      'You are alice.',
      'my-team',
      '.nightshift/teams/my-team',
      teamMembers,
      [],
    );
    expect(result).toContain('You are alice.');
  });

  it('includes team name and team folder', () => {
    const result = buildSystemPrompt(
      TEAM_TEMPLATE,
      'Prompt.',
      'my-team',
      '.nightshift/teams/my-team',
      teamMembers,
      [],
    );
    expect(result).toContain('**my-team**');
    expect(result).toContain('`.nightshift/teams/my-team`');
  });

  it('marks the lead member with (lead)', () => {
    const result = buildSystemPrompt(
      TEAM_TEMPLATE,
      'Prompt.',
      'my-team',
      '.nightshift/teams/my-team',
      teamMembers,
      [],
    );
    expect(result).toContain('**alice** (lead)');
    expect(result).not.toContain('**bob** (lead)');
  });

  it('substitutes projectBranch into the template', () => {
    const result = buildSystemPrompt(
      PROJECT_TEMPLATE,
      'Prompt.',
      'my-team',
      '.nightshift/teams/my-team',
      teamMembers,
      [],
      'feature/my-branch',
    );
    expect(result).toContain('`feature/my-branch`');
  });

  it('chatSection is empty when chatContext is empty', () => {
    const result = buildSystemPrompt(
      TEAM_TEMPLATE,
      'Prompt.',
      'my-team',
      '.nightshift/teams/my-team',
      teamMembers,
      [],
    );
    // The heading comes from the template and is always present
    expect(result).toContain('Recent Team Chat');
    // But no message lines appear
    expect(result).not.toContain('User:');
  });

  it('includes chat history lines when chatContext is provided', () => {
    const messages = [
      makeMsg('user', 'Hello team'),
      makeMsg('alice', 'Hi there'),
    ];
    const result = buildSystemPrompt(
      TEAM_TEMPLATE,
      'Prompt.',
      'my-team',
      '.nightshift/teams/my-team',
      teamMembers,
      messages,
    );
    expect(result).toContain('Recent Team Chat');
    expect(result).toContain('User: Hello team');
    expect(result).toContain('alice: Hi there');
  });

  it('instructs use of @user to hand back to human', () => {
    const result = buildSystemPrompt(
      TEAM_TEMPLATE,
      'Prompt.',
      'my-team',
      '.nightshift/teams/my-team',
      teamMembers,
      [],
    );
    expect(result).toContain('@user');
  });

  it('labels chat context as "Recent Project Chat" when projectBranch is provided', () => {
    const messages = [makeMsg('user', 'Hello project')];
    const result = buildSystemPrompt(
      PROJECT_TEMPLATE,
      'Prompt.',
      'my-team',
      '.nightshift/teams/my-team',
      teamMembers,
      messages,
      'feature/my-branch',
    );
    expect(result).toContain('Recent Project Chat');
    expect(result).not.toContain('Recent Team Chat');
  });

  it('labels chat context as "Recent Team Chat" when no projectBranch', () => {
    const messages = [makeMsg('user', 'Hello team')];
    const result = buildSystemPrompt(
      TEAM_TEMPLATE,
      'Prompt.',
      'my-team',
      '.nightshift/teams/my-team',
      teamMembers,
      messages,
    );
    expect(result).toContain('Recent Team Chat');
    expect(result).not.toContain('Recent Project Chat');
  });
});

// ---------------------------------------------------------------------------
// runAgent
// ---------------------------------------------------------------------------

/** Helper to build an async generator from an array of messages */
async function* makeStream(messages: unknown[]): AsyncGenerator<unknown> {
  for (const msg of messages) {
    yield msg;
  }
}

const BASE_AGENT_ARGS = {
  agentName: 'test-agent',
  userMessage: 'Hello, agent!',
  cwd: '/fake/cwd',
};

describe('runAgent', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockReadFile.mockReset();
    // Default: agent meta for .md files, minimal template for .spec.md files
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith('.spec.md')) {
        return '${agentPrompt}\n\n${memberLines}\n\nMention `@user`.\n\n## Recent Team Chat\n\n${chatSection}';
      }
      return `---
name: test-agent
description: A test agent
---
You are a test agent.`;
    });
  });

  it('returns the result text from a successful single-turn completion', async () => {
    mockQuery.mockReturnValue(
      makeStream([
        { type: 'system', subtype: 'init', session_id: 'sess-abc' },
        { type: 'result', subtype: 'success', result: 'Hello back!' },
      ]),
    );

    const result = await runAgent(BASE_AGENT_ARGS);
    expect(result).toBe('Hello back!');
  });

  it('calls onStatus with working then idle', async () => {
    mockQuery.mockReturnValue(
      makeStream([{ type: 'result', subtype: 'success', result: 'done' }]),
    );

    const statusCalls: Array<['idle' | 'working', string?]> = [];
    await runAgent({
      ...BASE_AGENT_ARGS,
      onStatus: (status, text) => statusCalls.push([status, text]),
    });

    // First call must be working/thinking
    expect(statusCalls[0]).toEqual(['working', 'thinking...']);
    // Last call must always be idle (from the finally block)
    expect(statusCalls[statusCalls.length - 1][0]).toBe('idle');
  });

  it('calls onSessionId with the session id from the init event', async () => {
    mockQuery.mockReturnValue(
      makeStream([
        { type: 'system', subtype: 'init', session_id: 'new-session-id' },
        { type: 'result', subtype: 'success', result: 'ok' },
      ]),
    );

    const sessionIds: string[] = [];
    await runAgent({
      ...BASE_AGENT_ARGS,
      onSessionId: (id) => sessionIds.push(id),
    });

    expect(sessionIds).toEqual(['new-session-id']);
  });

  it('does not call onSessionId when existingSdkSessionId is provided', async () => {
    mockQuery.mockReturnValue(
      makeStream([
        { type: 'system', subtype: 'init', session_id: 'new-session-id' },
        { type: 'result', subtype: 'success', result: 'resumed' },
      ]),
    );

    const sessionIds: string[] = [];
    await runAgent({
      ...BASE_AGENT_ARGS,
      existingSdkSessionId: 'existing-session',
      onSessionId: (id) => sessionIds.push(id),
    });

    expect(sessionIds).toHaveLength(0);
  });

  it('sets status to idle in finally block even if stream throws', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sess-err' };
        throw new Error('stream exploded');
      })(),
    );

    const statusCalls: Array<'idle' | 'working'> = [];
    await expect(
      runAgent({
        ...BASE_AGENT_ARGS,
        onStatus: (status) => statusCalls.push(status),
      }),
    ).rejects.toThrow('stream exploded');

    expect(statusCalls[statusCalls.length - 1]).toBe('idle');
  });

  it('surfaces thinking text via onStatus as it accumulates past the flush threshold', async () => {
    const longThinking = 'a'.repeat(160); // > 150 chars — triggers a flush
    mockQuery.mockReturnValue(
      makeStream([
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'thinking_delta', thinking: longThinking },
          },
        },
        {
          type: 'stream_event',
          event: { type: 'content_block_stop' },
        },
        { type: 'result', subtype: 'success', result: 'thought about it' },
      ]),
    );

    const workingTexts: string[] = [];
    await runAgent({
      ...BASE_AGENT_ARGS,
      onStatus: (status, text) => {
        if (status === 'working' && text && text !== 'thinking...') {
          workingTexts.push(text);
        }
      },
    });

    // The thinking block must have been surfaced at least once
    expect(workingTexts.length).toBeGreaterThan(0);
    expect(workingTexts.some((t) => t.includes('a'.repeat(10)))).toBe(true);
  });

  it('does NOT flush thinking status when buffer has grown less than 150 chars', async () => {
    const shortThinking = 'a'.repeat(100); // < 150 chars — should NOT trigger flush
    mockQuery.mockReturnValue(
      makeStream([
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'thinking_delta', thinking: shortThinking },
          },
        },
        // No content_block_stop here — so no final flush either
        { type: 'result', subtype: 'success', result: 'done' },
      ]),
    );

    const workingThinkingCalls: string[] = [];
    await runAgent({
      ...BASE_AGENT_ARGS,
      onStatus: (status, text) => {
        if (
          status === 'working' &&
          text &&
          text !== 'thinking...' &&
          text.length > 10
        ) {
          workingThinkingCalls.push(text);
        }
      },
    });

    // Should NOT have been flushed mid-stream (no content_block_stop was emitted)
    expect(workingThinkingCalls).toHaveLength(0);
  });

  it('returns empty string when stream ends without a success result', async () => {
    mockQuery.mockReturnValue(
      makeStream([
        { type: 'system', subtype: 'init', session_id: 'sess-noresult' },
        // No result message — stream just ends
      ]),
    );

    const result = await runAgent(BASE_AGENT_ARGS);
    expect(result).toBe('');
  });

  it('passes cwd to SDK when no worktreeDir is given', async () => {
    mockQuery.mockReturnValue(
      makeStream([{ type: 'result', subtype: 'success', result: 'done' }]),
    );

    await runAgent({ ...BASE_AGENT_ARGS, cwd: '/repo-root' });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ cwd: '/repo-root' }),
      }),
    );
  });

  it('passes worktreeDir to SDK as cwd when provided', async () => {
    mockQuery.mockReturnValue(
      makeStream([{ type: 'result', subtype: 'success', result: 'done' }]),
    );

    await runAgent({
      ...BASE_AGENT_ARGS,
      cwd: '/repo-root',
      worktreeDir: '/repo-root/.nightshift/worktrees/my-feature',
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          cwd: '/repo-root/.nightshift/worktrees/my-feature',
        }),
      }),
    );
  });

  it('reads agent metadata from cwd (git root) even when worktreeDir differs', async () => {
    mockQuery.mockReturnValue(
      makeStream([{ type: 'result', subtype: 'success', result: 'done' }]),
    );

    await runAgent({
      ...BASE_AGENT_ARGS,
      cwd: '/repo-root',
      worktreeDir: '/repo-root/.nightshift/worktrees/my-feature',
    });

    // readFile should have been called with the git-root path, not the worktree path
    expect(mockReadFile).toHaveBeenCalledWith(
      expect.stringContaining('/repo-root/.nightshift/agents/test-agent.md'),
      'utf-8',
    );
    expect(mockReadFile).not.toHaveBeenCalledWith(
      expect.stringContaining('worktrees'),
      'utf-8',
    );
  });
});
