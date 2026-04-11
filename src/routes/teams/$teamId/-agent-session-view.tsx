import type React from 'react';
import Markdown from 'react-markdown';
import { cn } from '~/lib/utils';
import type { ContentBlock, NavBlock } from './-nav-blocks';

const markdownComponents = {
  h1: FlatHeading,
  h2: FlatHeading,
  h3: FlatHeading,
  h4: FlatHeading,
  h5: FlatHeading,
  h6: FlatHeading,
};

function FlatHeading({ children }: { children?: React.ReactNode }) {
  return <p className="font-bold">{children}</p>;
}

export function SessionBlockContent({ block }: { block: ContentBlock }) {
  if (block.type === 'text') {
    const b = block as { type: 'text'; text: string };
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none text-sm text-foreground">
        <Markdown components={markdownComponents}>{b.text}</Markdown>
      </div>
    );
  }
  if (block.type === 'thinking') {
    const b = block as { type: 'thinking'; thinking: string };
    return (
      <details className="text-xs text-muted-foreground/50">
        <summary className="cursor-pointer select-none">thinking</summary>
        <p className="mt-1 whitespace-pre-wrap">{b.thinking}</p>
      </details>
    );
  }
  if (block.type === 'tool_use') {
    const b = block as { type: 'tool_use'; name: string; input: unknown };
    return (
      <details className="text-xs text-muted-foreground/50">
        <summary className="cursor-pointer select-none">{b.name}</summary>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(b.input, null, 2)}
        </pre>
      </details>
    );
  }
  return null;
}

export function AgentSessionView({
  agentName,
  systemPrompt,
  navBlocks,
  focusedIdx,
  onFocusBlock,
  bottomRef,
}: {
  agentName: string;
  systemPrompt?: string | null;
  navBlocks: NavBlock[];
  focusedIdx: number;
  onFocusBlock: (i: number) => void;
  bottomRef: React.RefObject<HTMLDivElement | null>;
}) {
  type BlockGroup = { blocks: { b: NavBlock; idx: number }[] };
  const groups: BlockGroup[] = [{ blocks: [] }];
  for (let i = 0; i < navBlocks.length; i++) {
    const nb = navBlocks[i];
    if (nb.kind !== 'session') continue;
    groups[0].blocks.push({ b: nb, idx: i });
  }

  return (
    <div className="px-4 py-4 flex flex-col gap-4 mt-auto">
      {systemPrompt && (
        <details className="text-xs text-muted-foreground/50">
          <summary className="cursor-pointer select-none font-medium">
            system prompt
          </summary>
          <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-relaxed">
            {systemPrompt}
          </pre>
        </details>
      )}
      {navBlocks.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No session history for {agentName} yet.
        </p>
      )}
      {groups[0].blocks.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-bold mb-1 text-secondary">
            {agentName}
          </span>
          {groups[0].blocks.map(({ b, idx }) => {
            const isFocused = idx === focusedIdx;
            if (b.kind !== 'session') return null;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => onFocusBlock(idx)}
                className={cn(
                  'text-left w-full py-0.5 pl-2 -ml-2 rounded-sm transition-colors',
                  isFocused ? 'bg-primary/10' : 'hover:bg-accent/20',
                )}
              >
                <SessionBlockContent block={b.block} />
              </button>
            );
          })}
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
