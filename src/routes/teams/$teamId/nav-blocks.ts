import type { Message } from '~/db/messages';
import type { AgentSessionMessage } from '~/server/team-data';

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; content: unknown }
  | { type: string; [key: string]: unknown };

export type NavBlock =
  | {
      kind: 'chat';
      id: string;
      sender: string;
      content: string;
      isUser: boolean;
    }
  | {
      kind: 'session';
      id: string;
      role: string;
      isUser: boolean;
      block: ContentBlock;
    };

export function flattenSessionBlocks(
  messages: AgentSessionMessage[],
): NavBlock[] {
  const result: NavBlock[] = [];
  for (const msg of messages) {
    if (msg.type === 'system') continue;
    const raw = msg.message;
    const role = (raw?.role as string | undefined) ?? msg.type;
    const isUser = role === 'user';
    const content = raw?.content;
    const blocks: ContentBlock[] = (() => {
      if (!content) return [];
      if (typeof content === 'string') return [{ type: 'text', text: content }];
      if (Array.isArray(content)) return content as ContentBlock[];
      return [];
    })();
    if (isUser) continue;
    for (let i = 0; i < blocks.length; i++) {
      result.push({
        kind: 'session',
        id: `${msg.uuid}-${i}`,
        role,
        isUser,
        block: blocks[i],
      });
    }
  }
  return result;
}

export function navBlockText(b: NavBlock): string {
  if (b.kind === 'chat') return b.content;
  if (b.kind === 'session' && b.block.type === 'text')
    return (b.block as { type: 'text'; text: string }).text;
  if (b.kind === 'session' && b.block.type === 'thinking')
    return (b.block as { type: 'thinking'; thinking: string }).thinking;
  return '';
}

export function msgToNavBlocks(m: Message): NavBlock[] {
  const sender = m.sender === 'user' ? 'you' : m.sender;
  const isUser = m.sender === 'user';
  return m.content
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk, i) => ({
      kind: 'chat' as const,
      id: `${m.id}-p${i}`,
      sender,
      content: chunk,
      isUser,
    }));
}
