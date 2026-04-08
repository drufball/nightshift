import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { ChatView } from './chat-view';
import type { NavBlock } from './nav-blocks';

afterEach(cleanup);

// Helper to create chat NavBlocks
function makeChatBlock(
  id: string,
  content: string,
  sender = 'aria',
  isUser = false,
): NavBlock {
  return { kind: 'chat', id, sender, content, isUser };
}

// Wrapper that provides a real ref
function Wrapper({
  navBlocks = [] as NavBlock[],
  focusedIdx = -1,
  onFocusBlock = () => {},
  emptyText,
}: {
  navBlocks?: NavBlock[];
  focusedIdx?: number;
  onFocusBlock?: (i: number) => void;
  emptyText?: string;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  return (
    <ChatView
      navBlocks={navBlocks}
      focusedIdx={focusedIdx}
      onFocusBlock={onFocusBlock}
      bottomRef={bottomRef}
      emptyText={emptyText}
    />
  );
}

// ── ChatView ───────────────────────────────────────────────────────────────

describe('ChatView', () => {
  it('renders default empty state when navBlocks is empty', () => {
    render(<Wrapper navBlocks={[]} />);
    screen.getByText('Send a message to get started.');
  });

  it('renders custom emptyText when provided', () => {
    render(<Wrapper navBlocks={[]} emptyText="Nothing here yet." />);
    screen.getByText('Nothing here yet.');
  });

  it('does not render empty state message when blocks are present', () => {
    render(<Wrapper navBlocks={[makeChatBlock('b1', 'hello')]} />);
    expect(screen.queryByText('Send a message to get started.')).toBeNull();
  });

  it('renders sender label for a chat block', () => {
    render(<Wrapper navBlocks={[makeChatBlock('b1', 'hi', 'aria')]} />);
    screen.getByText('aria');
  });

  it('renders block content', () => {
    render(
      <Wrapper navBlocks={[makeChatBlock('b1', 'hello world', 'aria')]} />,
    );
    screen.getByText('hello world');
  });

  it('groups consecutive blocks from the same sender', () => {
    const blocks: NavBlock[] = [
      makeChatBlock('b1', 'first', 'aria'),
      makeChatBlock('b2', 'second', 'aria'),
    ];
    render(<Wrapper navBlocks={blocks} />);
    // Only one sender label should appear
    const labels = screen.getAllByText('aria');
    expect(labels).toHaveLength(1);
  });

  it('creates separate groups for different senders', () => {
    const blocks: NavBlock[] = [
      makeChatBlock('b1', 'hi', 'you', true),
      makeChatBlock('b2', 'hello back', 'aria', false),
    ];
    render(<Wrapper navBlocks={blocks} />);
    screen.getByText('you');
    screen.getByText('aria');
  });

  it('applies text-primary class to user sender labels', () => {
    const blocks: NavBlock[] = [makeChatBlock('b1', 'hi', 'you', true)];
    render(<Wrapper navBlocks={blocks} />);
    const label = screen.getByText('you');
    expect(label.className).toContain('text-primary');
  });

  it('applies text-secondary class to non-user sender labels', () => {
    const blocks: NavBlock[] = [makeChatBlock('b1', 'hello', 'aria', false)];
    render(<Wrapper navBlocks={blocks} />);
    const label = screen.getByText('aria');
    expect(label.className).toContain('text-secondary');
  });

  it('calls onFocusBlock with block index when clicked', async () => {
    const user = userEvent.setup();
    const onFocusBlock = mock(() => {});
    const blocks: NavBlock[] = [makeChatBlock('b0', 'click me', 'aria')];
    render(
      <Wrapper
        navBlocks={blocks}
        focusedIdx={-1}
        onFocusBlock={onFocusBlock}
      />,
    );

    const buttons = screen.getAllByRole('button');
    await user.click(buttons[0]);
    expect(onFocusBlock).toHaveBeenCalledWith(0);
  });

  it('applies focused highlight to focused block', () => {
    const blocks: NavBlock[] = [
      makeChatBlock('b0', 'first', 'aria'),
      makeChatBlock('b1', 'second', 'aria'),
    ];
    render(<Wrapper navBlocks={blocks} focusedIdx={1} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[1].className).toContain('bg-primary/10');
    expect(buttons[0].className).not.toContain('bg-primary/10');
  });

  it('skips non-chat blocks when building groups', () => {
    const blocks: NavBlock[] = [
      {
        kind: 'session',
        id: 's1',
        role: 'assistant',
        isUser: false,
        block: { type: 'text', text: 'session text' },
      },
    ];
    render(<Wrapper navBlocks={blocks} />);
    // session blocks should not appear as chat buttons
    expect(screen.queryByText('session text')).toBeNull();
  });
});
