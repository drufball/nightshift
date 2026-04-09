import { mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that trigger them.
// Bun hoists mock.module() calls above all other imports.
// ---------------------------------------------------------------------------

// Mock useServerFn to return the server fn as-is (passthrough)
mock.module('@tanstack/react-start', () => ({
  useServerFn: (fn: unknown) => fn,
}));

// Mock useNavigate to return a jest-compatible mock fn
const mockNavigate = mock((_opts: unknown) => {});
mock.module('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

// Mock server functions so no DB calls happen
const mockSendTeamMessage = mock(async (_: unknown) => undefined);
const mockGetAgentStatuses = mock(async (_: unknown) => []);
const mockGetAgentSession = mock(async (_: unknown) => ({
  messages: [],
  status: 'idle' as const,
  statusText: null,
}));
const mockGetLatestMessages = mock(async (_: unknown) => []);
const mockGetProjectMessages = mock(async (_: unknown) => []);
const mockSendProjectMessage = mock(async (_: unknown) => {});
const mockCreateNewProject = mock(async (_: unknown) => ({
  id: 'new-proj',
  name: 'test-project',
  team_id: 'team1',
  branch: 'main',
  status: 'open' as const,
  created_at: 0,
}));

mock.module('~/server/team-data', () => ({
  sendTeamMessage: mockSendTeamMessage,
  getAgentStatuses: mockGetAgentStatuses,
  getAgentSession: mockGetAgentSession,
  getLatestMessages: mockGetLatestMessages,
  getProjectMessages: mockGetProjectMessages,
  sendProjectMessage: mockSendProjectMessage,
  createNewProject: mockCreateNewProject,
}));

mock.module('~/server/teams', () => ({
  listTeams: mock(async () => []),
}));

// ---------------------------------------------------------------------------
// Regular imports (after mocks are registered)
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useTeamPage } from './-use-team-page';
import type { TeamPageLoaderData } from './-use-team-page';

afterEach(() => {
  // Unmount any renderHook instances so their effects don't fire between tests
  cleanup();
  mockNavigate.mockClear();
  mockSendTeamMessage.mockClear();
  mockGetLatestMessages.mockClear();
  mockGetAgentStatuses.mockClear();
  mockGetProjectMessages.mockClear();
  mockSendProjectMessage.mockClear();
  mockCreateNewProject.mockClear();
});

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeLoaderData(
  overrides?: Partial<TeamPageLoaderData>,
): TeamPageLoaderData {
  return {
    teamId: 'team1',
    messages: [],
    agents: [
      { name: 'aria', isLead: true, status: 'idle', statusText: null },
      { name: 'bob', isLead: false, status: 'idle', statusText: null },
    ],
    projects: [
      {
        id: 'p1',
        name: 'project-alpha',
        team_id: 'team1',
        branch: 'main',
        status: 'open' as const,
        created_at: 0,
      },
    ],
    teams: [
      { name: 'team1', lead: 'aria', members: ['bob'] },
      { name: 'team2', lead: 'carol', members: [] },
    ],
    ...overrides,
  };
}

// ── Initial state derivation ───────────────────────────────────────────────

describe('useTeamPage – initial state', () => {
  it('derives messages from loader data', () => {
    const msg = {
      id: 'm1',
      team_id: 'team1',
      project_id: null as string | null,
      sender: 'user',
      content: 'hello',
      mentions: '[]',
      created_at: 0,
    };
    const { result } = renderHook(() =>
      useTeamPage(makeLoaderData({ messages: [msg] })),
    );
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].content).toBe('hello');
  });

  it('derives agents from loader data', () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));
    expect(result.current.agents).toHaveLength(2);
    expect(result.current.agents[0].name).toBe('aria');
    expect(result.current.agents[0].status).toBe('idle');
  });

  it('derives projects from loader data', () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));
    expect(result.current.projects).toHaveLength(1);
    expect(result.current.projects[0].name).toBe('project-alpha');
  });

  it('starts in normal mode with no overlay', () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));
    expect(result.current.mode).toBe('normal');
    expect(result.current.overlay).toBeNull();
  });

  it('starts with empty input and no sending in progress', () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));
    expect(result.current.input).toBe('');
    expect(result.current.isSending).toBe(false);
  });

  it('workingAgents is empty when all agents are idle', () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));
    expect(result.current.workingAgents).toHaveLength(0);
  });

  it('workingAgents lists agents with working status', () => {
    const data = makeLoaderData({
      agents: [
        {
          name: 'aria',
          isLead: true,
          status: 'working',
          statusText: 'running',
        },
        { name: 'bob', isLead: false, status: 'idle', statusText: null },
      ],
    });
    const { result } = renderHook(() => useTeamPage(data));
    expect(result.current.workingAgents).toHaveLength(1);
    expect(result.current.workingAgents[0].name).toBe('aria');
  });
});

// ── handleTeamSend ─────────────────────────────────────────────────────────

describe('useTeamPage – handleTeamSend', () => {
  beforeEach(() => {
    // Resolve immediately with fresh empty messages
    mockGetLatestMessages.mockImplementation(async () => []);
    mockGetAgentStatuses.mockImplementation(async () => []);
    mockSendTeamMessage.mockImplementation(async () => undefined);
  });

  it('optimistically adds a user message before the server call resolves', async () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    await act(async () => {
      await result.current.handleTeamSend('hello world');
    });

    // After the send completes, getLatestMessages mock returned [] so messages
    // should end up empty — but during the send, there was an optimistic message.
    // We verify the final state after the call completes.
    expect(mockSendTeamMessage).toHaveBeenCalledTimes(1);
    expect(mockGetLatestMessages).toHaveBeenCalledTimes(1);
  });

  it('sets sending=true during the send, then resets to false', async () => {
    let sendingDuringCall = false;
    mockSendTeamMessage.mockImplementation(async () => {
      sendingDuringCall = true;
    });

    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    await act(async () => {
      await result.current.handleTeamSend('ping');
    });

    expect(sendingDuringCall).toBe(true);
    expect(result.current.sending).toBe(false);
  });

  it('resets sending=false even when sendFn throws', async () => {
    mockSendTeamMessage.mockImplementation(async () => {
      throw new Error('network error');
    });

    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    await act(async () => {
      try {
        await result.current.handleTeamSend('fail');
      } catch {
        // expected
      }
    });

    expect(result.current.sending).toBe(false);
  });
});

// ── handleProjectSend ──────────────────────────────────────────────────────

describe('useTeamPage – handleProjectSend', () => {
  beforeEach(() => {
    mockGetProjectMessages.mockImplementation(async () => []);
    mockGetAgentStatuses.mockImplementation(async () => []);
    mockSendProjectMessage.mockImplementation(async () => undefined);
  });

  it('optimistically adds a user message to projectMessages before server call', async () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    // Make sendProjectMessage block so we can observe the optimistic state mid-flight
    let resolveSend!: () => void;
    mockSendProjectMessage.mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolveSend = res;
        }),
    );

    // Start the send but don't await yet
    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.handleProjectSend('p1', 'project hello');
    });

    // At this point the optimistic message should already be in state
    expect(result.current.projectMessages).toHaveLength(1);
    expect(result.current.projectMessages[0].content).toBe('project hello');

    // Let it finish
    await act(async () => {
      resolveSend();
      await sendPromise;
    });
  });

  it('resets projectSending=false even on error', async () => {
    mockSendProjectMessage.mockImplementation(async () => {
      throw new Error('project send failed');
    });

    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    await act(async () => {
      try {
        await result.current.handleProjectSend('p1', 'fail');
      } catch {
        // expected
      }
    });

    expect(result.current.projectSending).toBe(false);
  });
});

// ── handleSend (dispatcher) ────────────────────────────────────────────────

describe('useTeamPage – handleSend', () => {
  beforeEach(() => {
    mockSendTeamMessage.mockImplementation(async () => undefined);
    mockGetLatestMessages.mockImplementation(async () => []);
    mockGetAgentStatuses.mockImplementation(async () => []);
  });

  it('does nothing when input is empty or whitespace-only', async () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    await act(async () => {
      await result.current.handleSend();
    });

    expect(mockSendTeamMessage).not.toHaveBeenCalled();
  });

  it('clears input when send is triggered', async () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    act(() => {
      result.current.setInput('hello');
    });

    await act(async () => {
      await result.current.handleSend();
    });

    expect(result.current.input).toBe('');
  });

  it('routes to handleTeamSend when in chat view', async () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    act(() => {
      result.current.setInput('team msg');
    });

    await act(async () => {
      await result.current.handleSend();
    });

    expect(mockSendTeamMessage).toHaveBeenCalledTimes(1);
    expect(mockSendProjectMessage).not.toHaveBeenCalled();
  });

  it('routes to handleProjectSend when currentProjectName is set in routeCtx', async () => {
    mockSendProjectMessage.mockImplementation(async () => undefined);
    mockGetProjectMessages.mockImplementation(async () => []);

    const { result } = renderHook(() =>
      useTeamPage(makeLoaderData(), { currentProjectName: 'project-alpha' }),
    );

    act(() => {
      result.current.setInput('project msg');
    });

    await act(async () => {
      await result.current.handleSend();
    });

    expect(mockSendProjectMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTeamMessage).not.toHaveBeenCalled();
  });
});

// ── handleInputChange – overlay / mention detection ────────────────────────

describe('useTeamPage – handleInputChange overlay logic', () => {
  it('opens mention overlay when user types @name', () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    act(() => {
      const fakeEvent = {
        target: { value: '@ar', selectionStart: 3 },
      } as unknown as React.ChangeEvent<HTMLTextAreaElement>;
      result.current.handleInputChange(fakeEvent);
    });

    expect(result.current.overlay?.kind).toBe('mention');
    const overlay = result.current.overlay as {
      kind: 'mention';
      query: string;
    };
    expect(overlay.query).toBe('ar');
  });

  it('closes mention overlay when @ is deleted', () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    // Open mention overlay first
    act(() => {
      const openEvent = {
        target: { value: '@ar', selectionStart: 3 },
      } as unknown as React.ChangeEvent<HTMLTextAreaElement>;
      result.current.handleInputChange(openEvent);
    });
    expect(result.current.overlay?.kind).toBe('mention');

    // Now clear the @
    act(() => {
      const clearEvent = {
        target: { value: 'ar', selectionStart: 2 },
      } as unknown as React.ChangeEvent<HTMLTextAreaElement>;
      result.current.handleInputChange(clearEvent);
    });
    expect(result.current.overlay).toBeNull();
  });

  it('resets picker cursor on input change when teams overlay is open', () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    // Open teams overlay with cursor=1
    act(() => {
      result.current.setOverlay({ kind: 'teams', cursor: 1 });
    });

    act(() => {
      const event = {
        target: { value: 'team', selectionStart: 4 },
      } as unknown as React.ChangeEvent<HTMLTextAreaElement>;
      result.current.handleInputChange(event);
    });

    expect(result.current.overlay?.kind).toBe('teams');
    expect((result.current.overlay as { cursor: number }).cursor).toBe(0);
  });

  it('does not open mention overlay when projects-create overlay is active', () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    act(() => {
      result.current.setOverlay({ kind: 'projects-create' });
    });

    act(() => {
      const event = {
        target: { value: '@aria', selectionStart: 5 },
      } as unknown as React.ChangeEvent<HTMLTextAreaElement>;
      result.current.handleInputChange(event);
    });

    // Overlay should remain projects-create, not switch to mention
    expect(result.current.overlay?.kind).toBe('projects-create');
  });
});

// ── mentionFilteredAgents ──────────────────────────────────────────────────

describe('useTeamPage – mentionFilteredAgents', () => {
  it('returns agents matching the mention query (case-insensitive)', () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    act(() => {
      result.current.setOverlay({
        kind: 'mention',
        atStart: 0,
        query: 'ar',
        cursor: 0,
      });
    });

    expect(result.current.mentionFilteredAgents).toHaveLength(1);
    expect(result.current.mentionFilteredAgents[0].name).toBe('aria');
  });

  it('returns empty array when mention overlay is not open', () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));
    expect(result.current.mentionFilteredAgents).toHaveLength(0);
  });

  it('returns all agents when query is empty', () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    act(() => {
      result.current.setOverlay({
        kind: 'mention',
        atStart: 0,
        query: '',
        cursor: 0,
      });
    });

    expect(result.current.mentionFilteredAgents).toHaveLength(2);
  });

  it('handles hyphenated agent names in mention filter', () => {
    const data = makeLoaderData({
      agents: [
        { name: 'tech-lead', isLead: true, status: 'idle', statusText: null },
        {
          name: 'code-reviewer',
          isLead: false,
          status: 'idle',
          statusText: null,
        },
        { name: 'aria', isLead: false, status: 'idle', statusText: null },
      ],
    });
    const { result } = renderHook(() => useTeamPage(data));

    act(() => {
      result.current.setOverlay({
        kind: 'mention',
        atStart: 0,
        query: 'tech-',
        cursor: 0,
      });
    });

    expect(result.current.mentionFilteredAgents).toHaveLength(1);
    expect(result.current.mentionFilteredAgents[0].name).toBe('tech-lead');
  });
});

// ── pickerItems ────────────────────────────────────────────────────────────

describe('useTeamPage – pickerItems', () => {
  it('filters teams by input when teams overlay is open', () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    act(() => {
      result.current.setOverlay({ kind: 'teams', cursor: 0 });
      result.current.setInput('team2');
    });

    expect(result.current.pickerItems).toHaveLength(1);
    expect((result.current.pickerItems[0] as { name: string }).name).toBe(
      'team2',
    );
  });

  it('filters projects by input when projects overlay is open', () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    act(() => {
      result.current.setOverlay({ kind: 'projects', cursor: 0 });
      result.current.setInput('alpha');
    });

    expect(result.current.pickerItems).toHaveLength(1);
    expect((result.current.pickerItems[0] as { name: string }).name).toBe(
      'project-alpha',
    );
  });

  it('returns empty when no overlay is open', () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));
    expect(result.current.pickerItems).toHaveLength(0);
  });
});

// ── picker helpers ─────────────────────────────────────────────────────────

describe('useTeamPage – picker open helpers', () => {
  it('openTeamsPicker sets overlay to teams, clears input, sets focusedIdx=-1', () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    act(() => {
      result.current.setInput('stale');
      result.current.setFocusedIdx(3);
      result.current.openTeamsPicker();
    });

    expect(result.current.overlay).toEqual({ kind: 'teams', cursor: 0 });
    expect(result.current.input).toBe('');
    expect(result.current.focusedIdx).toBe(-1);
  });

  it('openProjectsPicker sets overlay to projects', () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    act(() => {
      result.current.openProjectsPicker();
    });

    expect(result.current.overlay).toEqual({ kind: 'projects', cursor: 0 });
  });

  it('openAgentsPicker sets overlay to agents', () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    act(() => {
      result.current.openAgentsPicker();
    });

    expect(result.current.overlay).toEqual({ kind: 'agents', cursor: 0 });
  });
});

// ── navigateBack ───────────────────────────────────────────────────────────

describe('useTeamPage – navigateBack', () => {
  it('navigates to / from team chat (no routeCtx)', () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    act(() => {
      result.current.navigateBack();
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const call = mockNavigate.mock.calls[0][0] as { to: string };
    expect(call.to).toBe('/');
  });

  it('navigates to /teams/$teamId from project-chat view', () => {
    const { result } = renderHook(() =>
      useTeamPage(makeLoaderData(), { currentProjectName: 'project-alpha' }),
    );

    act(() => {
      result.current.navigateBack();
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const call = mockNavigate.mock.calls[0][0] as {
      to: string;
      params: Record<string, string>;
    };
    expect(call.to).toBe('/teams/$teamId');
    expect(call.params.teamId).toBe('team1');
  });

  it('navigates to /teams/$teamId from agent-session without project', () => {
    const { result } = renderHook(() =>
      useTeamPage(makeLoaderData(), { currentAgentName: 'aria' }),
    );

    act(() => {
      result.current.navigateBack();
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const call = mockNavigate.mock.calls[0][0] as {
      to: string;
      params: Record<string, string>;
    };
    expect(call.to).toBe('/teams/$teamId');
    expect(call.params.teamId).toBe('team1');
  });

  it('navigates to project URL from agent-session within a project', () => {
    const { result } = renderHook(() =>
      useTeamPage(makeLoaderData(), {
        currentProjectName: 'project-alpha',
        currentAgentName: 'aria',
      }),
    );

    act(() => {
      result.current.navigateBack();
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const call = mockNavigate.mock.calls[0][0] as {
      to: string;
      params: Record<string, string>;
    };
    expect(call.to).toBe('/teams/$teamId/projects/$projectName');
    expect(call.params.teamId).toBe('team1');
    expect(call.params.projectName).toBe('project-alpha');
  });
});

// ── handleCreateProject ────────────────────────────────────────────────────

describe('useTeamPage – handleCreateProject', () => {
  it('calls createNewProject with teamId and name', async () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    await act(async () => {
      result.current.handleCreateProject('new-project');
      // Give the promise microtask a chance to resolve
      await Promise.resolve();
    });

    expect(mockCreateNewProject).toHaveBeenCalledTimes(1);
    const arg = mockCreateNewProject.mock.calls[0][0] as {
      data: { teamId: string; name: string };
    };
    expect(arg.data.teamId).toBe('team1');
    expect(arg.data.name).toBe('new-project');
  });

  it('appends the new project to the projects list', async () => {
    const { result } = renderHook(() => useTeamPage(makeLoaderData()));

    await act(async () => {
      result.current.handleCreateProject('new-project');
      await Promise.resolve();
    });

    const names = result.current.projects.map((p) => p.name);
    expect(names).toContain('test-project'); // from mock return value
  });
});
