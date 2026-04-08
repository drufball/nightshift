import type React from 'react';
import Markdown from 'react-markdown';
import { cn } from '~/lib/utils';
import type { NavBlock } from './nav-blocks';

function FlatHeading({ children }: { children?: React.ReactNode }) {
  return <p className="font-bold">{children}</p>;
}

const markdownComponents = {
  h1: FlatHeading,
  h2: FlatHeading,
  h3: FlatHeading,
  h4: FlatHeading,
  h5: FlatHeading,
  h6: FlatHeading,
};

export function ChatView({
  navBlocks,
  focusedIdx,
  onFocusBlock,
  bottomRef,
  emptyText = 'Send a message to get started.',
}: {
  navBlocks: NavBlock[];
  focusedIdx: number;
  onFocusBlock: (i: number) => void;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  emptyText?: string;
}) {
  type Group = {
    sender: string;
    isUser: boolean;
    blocks: { b: NavBlock; idx: number }[];
  };
  const groups: Group[] = [];
  for (let i = 0; i < navBlocks.length; i++) {
    const nb = navBlocks[i];
    if (nb.kind !== 'chat') continue;
    const last = groups[groups.length - 1];
    if (last && last.sender === nb.sender) {
      last.blocks.push({ b: nb, idx: i });
    } else {
      groups.push({
        sender: nb.sender,
        isUser: nb.isUser,
        blocks: [{ b: nb, idx: i }],
      });
    }
  }

  return (
    <div className="px-4 py-4 flex flex-col gap-4 mt-auto">
      {navBlocks.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {emptyText}
        </p>
      )}
      {groups.map((group) => (
        <div key={group.blocks[0].b.id} className="flex flex-col gap-0.5">
          <span
            className={cn(
              'text-sm font-bold mb-1',
              group.isUser ? 'text-primary' : 'text-secondary',
            )}
          >
            {group.sender}
          </span>
          {group.blocks.map(({ b, idx }) => {
            if (b.kind !== 'chat') return null;
            const isFocused = idx === focusedIdx;
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
                <div className="prose prose-sm dark:prose-invert max-w-none text-sm text-foreground">
                  <Markdown components={markdownComponents}>
                    {b.content}
                  </Markdown>
                </div>
              </button>
            );
          })}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
