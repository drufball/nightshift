import { describe, expect, it } from 'bun:test';
import type { Message } from '~/db/messages';
import {
  buildSystemPrompt,
  formatToolStatus,
  parseAgentMeta,
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

describe('buildSystemPrompt', () => {
  const teamMembers = [
    { name: 'alice', description: 'Lead engineer', isLead: true },
    { name: 'bob', description: 'Backend dev', isLead: false },
  ];

  it('includes the agent base prompt', () => {
    const result = buildSystemPrompt(
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
      'Prompt.',
      'my-team',
      '.nightshift/teams/my-team',
      teamMembers,
      [],
    );
    expect(result).toContain('**alice** (lead)');
    expect(result).not.toContain('**bob** (lead)');
  });

  it('includes project branch when provided', () => {
    const result = buildSystemPrompt(
      'Prompt.',
      'my-team',
      '.nightshift/teams/my-team',
      teamMembers,
      [],
      'feature/my-branch',
    );
    expect(result).toContain('`feature/my-branch`');
  });

  it('omits Recent Team Chat section when chatContext is empty', () => {
    const result = buildSystemPrompt(
      'Prompt.',
      'my-team',
      '.nightshift/teams/my-team',
      teamMembers,
      [],
    );
    expect(result).not.toContain('Recent Team Chat');
  });

  it('includes chat history lines when chatContext is provided', () => {
    const messages = [
      makeMsg('user', 'Hello team'),
      makeMsg('alice', 'Hi there'),
    ];
    const result = buildSystemPrompt(
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
      'Prompt.',
      'my-team',
      '.nightshift/teams/my-team',
      teamMembers,
      [],
    );
    expect(result).toContain('@user');
  });
});
