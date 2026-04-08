import { describe, expect, it } from 'bun:test';
import type { Message } from '~/db/messages';
import type { AgentSessionMessage } from '~/server/team-data';
import {
  flattenSessionBlocks,
  msgToNavBlocks,
  navBlockText,
} from './nav-blocks';

// ── flattenSessionBlocks ───────────────────────────────────────────────────

describe('flattenSessionBlocks', () => {
  it('returns empty array for empty input', () => {
    expect(flattenSessionBlocks([])).toEqual([]);
  });

  it('skips system messages', () => {
    const msgs: AgentSessionMessage[] = [
      {
        uuid: 'u1',
        type: 'system',
        session_id: 's1',
        parent_tool_use_id: null,
        message: { role: 'system', content: 'system prompt' },
      },
    ];
    expect(flattenSessionBlocks(msgs)).toEqual([]);
  });

  it('skips user role messages', () => {
    const msgs: AgentSessionMessage[] = [
      {
        uuid: 'u1',
        type: 'user',
        session_id: 's1',
        parent_tool_use_id: null,
        message: { role: 'user', content: 'hello' },
      },
    ];
    expect(flattenSessionBlocks(msgs)).toEqual([]);
  });

  it('returns a block for an assistant message with string content', () => {
    const msgs: AgentSessionMessage[] = [
      {
        uuid: 'abc',
        type: 'assistant',
        session_id: 's1',
        parent_tool_use_id: null,
        message: { role: 'assistant', content: 'hello there' },
      },
    ];
    const result = flattenSessionBlocks(msgs);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'session',
      id: 'abc-0',
      role: 'assistant',
      isUser: false,
      block: { type: 'text', text: 'hello there' },
    });
  });

  it('returns multiple blocks for assistant message with array content', () => {
    const msgs: AgentSessionMessage[] = [
      {
        uuid: 'xyz',
        type: 'assistant',
        session_id: 's1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'first' },
            { type: 'thinking', thinking: 'pondering' },
          ],
        },
      },
    ];
    const result = flattenSessionBlocks(msgs);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('xyz-0');
    expect(result[1].id).toBe('xyz-1');
    expect(result[0]).toMatchObject({ block: { type: 'text', text: 'first' } });
    expect(result[1]).toMatchObject({
      block: { type: 'thinking', thinking: 'pondering' },
    });
  });

  it('returns empty array when message content is absent', () => {
    const msgs: AgentSessionMessage[] = [
      {
        uuid: 'u2',
        type: 'assistant',
        session_id: 's1',
        parent_tool_use_id: null,
        message: { role: 'assistant', content: null },
      },
    ];
    expect(flattenSessionBlocks(msgs)).toEqual([]);
  });

  it('flattens multiple messages in order', () => {
    const msgs: AgentSessionMessage[] = [
      {
        uuid: 'm1',
        type: 'assistant',
        session_id: 's1',
        parent_tool_use_id: null,
        message: { role: 'assistant', content: 'msg one' },
      },
      {
        uuid: 'm2',
        type: 'assistant',
        session_id: 's1',
        parent_tool_use_id: null,
        message: { role: 'assistant', content: 'msg two' },
      },
    ];
    const result = flattenSessionBlocks(msgs);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('m1-0');
    expect(result[1].id).toBe('m2-0');
  });
});

// ── navBlockText ───────────────────────────────────────────────────────────

describe('navBlockText', () => {
  it('returns content for chat blocks', () => {
    const block = {
      kind: 'chat' as const,
      id: 'c1',
      sender: 'you',
      content: 'hello world',
      isUser: true,
    };
    expect(navBlockText(block)).toBe('hello world');
  });

  it('returns text for session text blocks', () => {
    const block = {
      kind: 'session' as const,
      id: 's1',
      role: 'assistant',
      isUser: false,
      block: { type: 'text' as const, text: 'response text' },
    };
    expect(navBlockText(block)).toBe('response text');
  });

  it('returns thinking for session thinking blocks', () => {
    const block = {
      kind: 'session' as const,
      id: 's2',
      role: 'assistant',
      isUser: false,
      block: { type: 'thinking' as const, thinking: 'deep thought' },
    };
    expect(navBlockText(block)).toBe('deep thought');
  });

  it('returns empty string for unrecognized session block types', () => {
    const block = {
      kind: 'session' as const,
      id: 's3',
      role: 'assistant',
      isUser: false,
      block: { type: 'tool_use', name: 'bash', input: {} },
    };
    expect(navBlockText(block)).toBe('');
  });
});

// ── msgToNavBlocks ─────────────────────────────────────────────────────────

describe('msgToNavBlocks', () => {
  const baseMsg = (overrides: Partial<Message>): Message => ({
    id: 'msg1',
    team_id: 'team1',
    project_id: null,
    sender: 'user',
    content: 'hello',
    mentions: '[]',
    created_at: 0,
    ...overrides,
  });

  it('returns empty array for empty content', () => {
    expect(msgToNavBlocks(baseMsg({ content: '' }))).toEqual([]);
  });

  it('returns single block for single-paragraph content', () => {
    const result = msgToNavBlocks(baseMsg({ content: 'hello' }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'chat',
      id: 'msg1-p0',
      sender: 'you',
      content: 'hello',
      isUser: true,
    });
  });

  it('splits on double newline into multiple blocks', () => {
    const result = msgToNavBlocks(baseMsg({ content: 'first\n\nsecond' }));
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ content: 'first', id: 'msg1-p0' });
    expect(result[1]).toMatchObject({ content: 'second', id: 'msg1-p1' });
  });

  it('filters out blank/whitespace-only paragraphs', () => {
    const result = msgToNavBlocks(baseMsg({ content: 'a\n\n   \n\nb' }));
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ content: 'a' });
    expect(result[1]).toMatchObject({ content: 'b' });
  });

  it('uses sender display name "you" for user messages', () => {
    const result = msgToNavBlocks(baseMsg({ sender: 'user', content: 'hi' }));
    expect(result[0]).toMatchObject({ sender: 'you', isUser: true });
  });

  it('uses actual sender name for non-user messages', () => {
    const result = msgToNavBlocks(
      baseMsg({ sender: 'aria', content: 'hi', id: 'msg2' }),
    );
    expect(result[0]).toMatchObject({ sender: 'aria', isUser: false });
  });
});
