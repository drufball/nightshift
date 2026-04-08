import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { AgentSessionView, SessionBlockContent } from './agent-session-view';
import type { NavBlock } from './nav-blocks';

afterEach(cleanup);

// Helper to create a session NavBlock
function makeSessionBlock(overrides: Partial<NavBlock> = {}): NavBlock {
  return {
    kind: 'session',
    id: 'b1',
    role: 'assistant',
    isUser: false,
    block: { type: 'text', text: 'hello' },
    ...overrides,
  } as NavBlock;
}

// Wrapper that provides a real ref
function Wrapper({
  agentName = 'aria',
  navBlocks = [] as NavBlock[],
  focusedIdx = -1,
  onFocusBlock = () => {},
}: {
  agentName?: string;
  navBlocks?: NavBlock[];
  focusedIdx?: number;
  onFocusBlock?: (i: number) => void;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  return (
    <AgentSessionView
      agentName={agentName}
      navBlocks={navBlocks}
      focusedIdx={focusedIdx}
      onFocusBlock={onFocusBlock}
      bottomRef={bottomRef}
    />
  );
}

// ── AgentSessionView ───────────────────────────────────────────────────────

describe('AgentSessionView', () => {
  it('renders empty-state message when navBlocks is empty', () => {
    render(<Wrapper agentName="aria" navBlocks={[]} />);
    screen.getByText(/No session history for aria yet/);
  });

  it('does not render empty-state message when there are blocks', () => {
    const blocks: NavBlock[] = [makeSessionBlock({ id: 'b1' })];
    render(<Wrapper navBlocks={blocks} />);
    expect(screen.queryByText(/No session history/)).toBeNull();
  });

  it('renders agent name label when blocks exist', () => {
    const blocks: NavBlock[] = [makeSessionBlock({ id: 'b1' })];
    render(<Wrapper agentName="aria" navBlocks={blocks} />);
    screen.getByText('aria');
  });

  it('renders text block content', () => {
    const blocks: NavBlock[] = [
      makeSessionBlock({
        id: 'b1',
        block: { type: 'text', text: 'some output text' },
      }),
    ];
    render(<Wrapper navBlocks={blocks} />);
    screen.getByText('some output text');
  });

  it('calls onFocusBlock with block index when a block button is clicked', async () => {
    const user = userEvent.setup();
    const onFocusBlock = mock(() => {});
    const blocks: NavBlock[] = [makeSessionBlock({ id: 'b0' })];
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

  it('applies focused style to the focused block', () => {
    const blocks: NavBlock[] = [
      makeSessionBlock({ id: 'b0' }),
      makeSessionBlock({ id: 'b1', block: { type: 'text', text: 'second' } }),
    ];
    render(<Wrapper navBlocks={blocks} focusedIdx={1} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[1].className).toContain('bg-primary/10');
    expect(buttons[0].className).not.toContain('bg-primary/10');
  });
});

// ── SessionBlockContent ────────────────────────────────────────────────────

describe('SessionBlockContent', () => {
  it('renders text block content', () => {
    render(
      <SessionBlockContent block={{ type: 'text', text: 'hello world' }} />,
    );
    screen.getByText('hello world');
  });

  it('renders thinking block as collapsible details', () => {
    render(
      <SessionBlockContent
        block={{ type: 'thinking', thinking: 'deep thought' }}
      />,
    );
    screen.getByText('thinking');
    screen.getByText('deep thought');
  });

  it('renders tool_use block with tool name as summary', () => {
    render(
      <SessionBlockContent
        block={{ type: 'tool_use', name: 'bash', input: { cmd: 'ls' } }}
      />,
    );
    screen.getByText('bash');
  });

  it('renders nothing for unknown block types', () => {
    const { container } = render(
      <SessionBlockContent block={{ type: 'unknown_type' }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
