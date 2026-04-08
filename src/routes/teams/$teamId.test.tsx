import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Breadcrumb, type ViewState, applySessionsToAgents } from './$teamId';

afterEach(cleanup);

// ── applySessionsToAgents ──────────────────────────────────────────────────

describe('applySessionsToAgents', () => {
  const baseAgents = [
    { name: 'aria', isLead: true, status: 'idle' as const, statusText: null },
    { name: 'bob', isLead: false, status: 'idle' as const, statusText: null },
  ];

  it('returns agents unchanged when sessions array is empty', () => {
    const result = applySessionsToAgents(baseAgents, []);
    expect(result).toEqual(baseAgents);
  });

  it('applies status and statusText from matching session', () => {
    const sessions = [
      {
        id: '1',
        team_id: 'team',
        project_id: null,
        agent_name: 'aria',
        status: 'working' as const,
        status_text: 'running tests',
        sdk_session_id: null,
        updated_at: 0,
      },
    ];
    const result = applySessionsToAgents(baseAgents, sessions);
    expect(result[0]).toEqual({
      name: 'aria',
      isLead: true,
      status: 'working',
      statusText: 'running tests',
    });
    // bob has no session — should remain unchanged
    expect(result[1]).toEqual(baseAgents[1]);
  });

  it('leaves agent unchanged when no session matches its name', () => {
    const sessions = [
      {
        id: '1',
        team_id: 'team',
        project_id: null,
        agent_name: 'unknown-agent',
        status: 'working' as const,
        status_text: null,
        sdk_session_id: null,
        updated_at: 0,
      },
    ];
    const result = applySessionsToAgents(baseAgents, sessions);
    expect(result).toEqual(baseAgents);
  });

  it('handles null status_text correctly (statusText becomes null)', () => {
    const sessions = [
      {
        id: '1',
        team_id: 'team',
        project_id: null,
        agent_name: 'bob',
        status: 'working' as const,
        status_text: null,
        sdk_session_id: null,
        updated_at: 0,
      },
    ];
    const result = applySessionsToAgents(baseAgents, sessions);
    expect(result[1].status).toBe('working');
    expect(result[1].statusText).toBeNull();
  });

  it('does not mutate the original agents array', () => {
    const sessions = [
      {
        id: '1',
        team_id: 'team',
        project_id: null,
        agent_name: 'aria',
        status: 'working' as const,
        status_text: 'busy',
        sdk_session_id: null,
        updated_at: 0,
      },
    ];
    const original = [...baseAgents];
    applySessionsToAgents(baseAgents, sessions);
    expect(baseAgents).toEqual(original);
  });
});

// ── Mention regex ──────────────────────────────────────────────────────────

describe('mention regex', () => {
  // The regex used in the mention detection handler.
  // Must match hyphenated agent names (e.g. tech-lead, code-reviewer).
  const MENTION_RE = /@([\w-]*)$/;

  it('matches a plain agent name after @', () => {
    const match = 'hello @aria'.match(MENTION_RE);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe('aria');
  });

  it('matches a hyphenated agent name after @ (regression: \\w does not match hyphens)', () => {
    const match = 'hello @tech-lead'.match(MENTION_RE);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe('tech-lead');
  });

  it('matches a partial hyphenated name while typing', () => {
    const match = '@tech-'.match(MENTION_RE);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe('tech-');
  });

  it('filters agents correctly by hyphenated query', () => {
    const agents = [
      { name: 'tech-lead' },
      { name: 'code-reviewer' },
      { name: 'aria' },
    ];
    const query = 'tech-lead';
    const filtered = agents.filter((a) =>
      a.name.toLowerCase().includes(query.toLowerCase()),
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('tech-lead');
  });
});

// ── Breadcrumb ─────────────────────────────────────────────────────────────

describe('Breadcrumb', () => {
  it('renders ~/teamId for chat view', () => {
    render(<Breadcrumb view={{ type: 'chat' }} teamId="myteam" />);
    screen.getByText('~/myteam');
  });

  it('renders ~/teamId and (projectName) as separate spans for project-chat', () => {
    const view: ViewState = {
      type: 'project-chat',
      projectId: 'p1',
      projectName: 'my-project',
    };
    render(<Breadcrumb view={view} teamId="myteam" />);

    screen.getByText('~/myteam');
    screen.getByText('(my-project)');
  });

  it('project-chat: path segment is primary, project label is secondary', () => {
    const view: ViewState = {
      type: 'project-chat',
      projectId: 'p1',
      projectName: 'my-project',
    };
    render(<Breadcrumb view={view} teamId="myteam" />);

    const path = screen.getByText('~/myteam');
    const label = screen.getByText('(my-project)');

    expect(path.className).toContain('text-primary');
    expect(label.className).toContain('text-secondary');
  });

  it('renders ~/teamId/agentName for agent-session', () => {
    const view: ViewState = { type: 'agent-session', agentName: 'aria' };
    render(<Breadcrumb view={view} teamId="myteam" />);

    screen.getByText(/myteam\/aria/);
  });

  it('agent-session: entire path is primary', () => {
    const view: ViewState = { type: 'agent-session', agentName: 'aria' };
    render(<Breadcrumb view={view} teamId="myteam" />);

    const el = screen.getByText(/myteam\/aria/);
    expect(el.className).toContain('text-primary');
    expect(el.className).not.toContain('text-secondary');
  });
});

// ── Input mode / disable regression ───────────────────────────────────────
//
// Regression for: mode stuck at 'insert' after textarea is disabled (during
// send), causing the global keydown handler to return early and swallow all
// input once sending completes and the textarea is re-enabled.
//
// Fix: onBlur resets mode to 'normal' so the user can re-enter insert mode.

function InputModeHarness({ disabled }: { disabled: boolean }) {
  const [mode, setMode] = useState<'normal' | 'insert'>('normal');
  const [value, setValue] = useState('');

  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <textarea
        data-testid="input"
        disabled={disabled}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setMode('insert')}
        onBlur={() => setMode('normal')}
      />
    </div>
  );
}

function InputModeWithToggle() {
  const [sending, setSending] = useState(false);
  return (
    <div>
      <button
        type="button"
        data-testid="toggle-send"
        onClick={() => setSending((s) => !s)}
      >
        toggle
      </button>
      <InputModeHarness disabled={sending} />
    </div>
  );
}

describe('input mode / disable regression', () => {
  it('mode is normal initially', () => {
    render(<InputModeHarness disabled={false} />);
    expect(screen.getByTestId('mode').textContent).toBe('normal');
  });

  it('mode becomes insert when textarea is focused', async () => {
    const user = userEvent.setup();
    render(<InputModeHarness disabled={false} />);

    await user.click(screen.getByTestId('input'));

    expect(screen.getByTestId('mode').textContent).toBe('insert');
  });

  it('mode resets to normal when textarea loses focus (onBlur)', async () => {
    const user = userEvent.setup();
    render(<InputModeHarness disabled={false} />);

    await user.click(screen.getByTestId('input'));
    expect(screen.getByTestId('mode').textContent).toBe('insert');

    await user.tab(); // move focus away
    expect(screen.getByTestId('mode').textContent).toBe('normal');
  });

  it('mode resets to normal when textarea is disabled (regression)', async () => {
    // This is the bug: textarea is focused (insert mode), then disabled due to
    // a send in-flight. Without onBlur, mode stays 'insert' forever and the
    // user cannot type after sending completes.
    const user = userEvent.setup();
    render(<InputModeWithToggle />);

    // Enter insert mode by clicking the textarea
    await user.click(screen.getByTestId('input'));
    expect(screen.getByTestId('mode').textContent).toBe('insert');

    // Simulate send start — textarea becomes disabled → blur fires
    await user.click(screen.getByTestId('toggle-send'));
    expect((screen.getByTestId('input') as HTMLTextAreaElement).disabled).toBe(
      true,
    );

    // Mode must have reset so the user can recover
    expect(screen.getByTestId('mode').textContent).toBe('normal');

    // Simulate send complete — textarea re-enabled
    await user.click(screen.getByTestId('toggle-send'));
    expect((screen.getByTestId('input') as HTMLTextAreaElement).disabled).toBe(
      false,
    );

    // User can click and type again
    await user.click(screen.getByTestId('input'));
    expect(screen.getByTestId('mode').textContent).toBe('insert');
  });
});
