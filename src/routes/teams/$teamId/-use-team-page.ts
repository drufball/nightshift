/**
 * useTeamPage – extracted state and handlers for TeamPage.
 *
 * Intentionally left in $teamId.tsx (not extracted here):
 *   - inputRef / bottomRef / hasInitialScrolled (DOM refs used directly in JSX)
 *   - textarea auto-resize effect (needs inputRef.current)
 *   - scroll-to-bottom effect (needs bottomRef.current)
 *   - insertMention (needs inputRef.current for selectionStart / setSelectionRange)
 *   - closePicker (calls inputRef.current?.blur())
 *   - handleInputKeyDown (calls insertMention / closePicker which need DOM refs)
 *   - handleInputChange overlay logic (calls setOverlay via overlayRef which is kept
 *     in sync with refs in the component)
 *   - Global keydown effect (navigates + uses all refs)
 *   - showInlinePicker / inputDisabled / inputPlaceholder (derived render values)
 *
 * What IS extracted here:
 *   - All state (messages, agents, projects, allTeams, input, sending, mode, view,
 *     overlay, focusedIdx, projectMessages, projectSending, sessionData)
 *   - modeRef / viewRef / overlayRef / focusedIdxRef (kept in sync via effects)
 *   - navBlocksRef + navBlocks useMemo
 *   - pickerItems / mentionFilteredAgents useMemos
 *   - selectedAgentStatus / workingAgents / currentProjectId derived values
 *   - All async send / load handlers (handleTeamSend, handleProjectSend, handleSend)
 *   - Server-fn polling effects (team send, project send, agent session)
 *   - project-chat message load effect (on view change)
 *   - Server function wrappers (useServerFn calls)
 */

import { useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Message } from '~/db/messages';
import type { Project } from '~/db/projects';
import type { AgentSession } from '~/db/sessions';
import {
  type AgentSessionMessage,
  createNewProject,
  getAgentSession,
  getAgentStatuses,
  getLatestMessages,
  getProjectMessages as getProjectMessagesFn,
  sendProjectMessage as sendProjectMessageFn,
  sendTeamMessage,
} from '~/server/team-data';
import type { TeamMeta } from '~/server/teams';
import {
  type NavBlock,
  flattenSessionBlocks,
  msgToNavBlocks,
  navBlockText,
} from './-nav-blocks';

// ── Types (re-exported for use in $teamId.tsx) ─────────────────────────────

export type AgentInfo = {
  name: string;
  isLead: boolean;
  status: 'idle' | 'working';
  statusText: string | null;
};

export type SessionData = {
  messages: AgentSessionMessage[];
  status: 'idle' | 'working';
  statusText: string | null;
};

export type ViewState =
  | { type: 'chat' }
  | { type: 'project-chat'; projectId: string; projectName: string }
  | {
      type: 'agent-session';
      agentName: string;
      projectId?: string;
      projectName?: string;
    };

export type OverlayState =
  | { kind: 'teams'; cursor: number }
  | { kind: 'projects'; cursor: number }
  | { kind: 'projects-create' }
  | { kind: 'agents'; cursor: number }
  | { kind: 'mention'; atStart: number; query: string; cursor: number };

// ── Loader data shape ──────────────────────────────────────────────────────

export type TeamPageLoaderData = {
  teamId: string;
  messages: Message[];
  agents: AgentInfo[];
  projects: Project[];
  teams: TeamMeta[];
};

// ── Internal helper (mirrors the export in $teamId.tsx) ────────────────────

function applySessionsToAgents(
  agents: AgentInfo[],
  sessions: AgentSession[],
): AgentInfo[] {
  return agents.map((a) => {
    const s = sessions.find((s) => s.agent_name === a.name);
    return s ? { ...a, status: s.status, statusText: s.status_text } : a;
  });
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useTeamPage(initialData: TeamPageLoaderData) {
  const { teamId } = initialData;
  const navigate = useNavigate();

  // ── State ──────────────────────────────────────────────────────────────

  const [messages, setMessages] = useState<Message[]>(initialData.messages);
  const [agents, setAgents] = useState<AgentInfo[]>(initialData.agents);
  const [projects, setProjects] = useState<Project[]>(initialData.projects);
  const [allTeams, setAllTeams] = useState<TeamMeta[]>(initialData.teams);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const [mode, setMode] = useState<'insert' | 'normal'>('normal');
  const [view, setView] = useState<ViewState>({ type: 'chat' });
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const [focusedIdx, setFocusedIdx] = useState(-1);

  const [projectMessages, setProjectMessages] = useState<Message[]>([]);
  const [projectSending, setProjectSending] = useState(false);
  const [sessionData, setSessionData] = useState<SessionData | null>(null);

  // Sync state when navigating to a different team (loader returns new data
  // but the component is reused, so useState initializers don't re-run).
  // Keyed on teamId (not the whole initialData object) to avoid infinite loops
  // when the parent passes a freshly-constructed object on every render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally sync all team state when teamId changes
  useEffect(() => {
    setMessages(initialData.messages);
    setAgents(initialData.agents);
    setProjects(initialData.projects);
    setAllTeams(initialData.teams);
    setView((prev) => (prev.type === 'chat' ? prev : { type: 'chat' }));
    setOverlay(null);
    setFocusedIdx(-1);
    setSessionData(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  // ── Refs (kept in sync via effects; used inside global keydown handler) ─

  const modeRef = useRef(mode);
  const viewRef = useRef(view);
  const overlayRef = useRef(overlay);
  const focusedIdxRef = useRef(focusedIdx);
  const navBlocksRef = useRef<NavBlock[]>([]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  useEffect(() => {
    overlayRef.current = overlay;
  }, [overlay]);
  useEffect(() => {
    focusedIdxRef.current = focusedIdx;
  }, [focusedIdx]);

  // ── Server functions ──────────────────────────────────────────────────

  const sendFn = useServerFn(sendTeamMessage);
  const getStatusesFn = useServerFn(getAgentStatuses);
  const getAgentSessionFn = useServerFn(getAgentSession);
  const getMessagesFn = useServerFn(getLatestMessages);
  const getProjectMsgsFn = useServerFn(getProjectMessagesFn);
  const sendProjectMsgFn = useServerFn(sendProjectMessageFn);
  const createProjectFn = useServerFn(createNewProject);

  // ── Derived values ────────────────────────────────────────────────────

  const currentProjectId = view.type === 'project-chat' ? view.projectId : null;

  const selectedAgentStatus =
    view.type === 'agent-session'
      ? (agents.find(
          (a) =>
            a.name ===
            (view as { type: 'agent-session'; agentName: string }).agentName,
        )?.status ?? 'idle')
      : 'idle';

  const navBlocks: NavBlock[] = useMemo(() => {
    if (view.type === 'chat') return messages.flatMap(msgToNavBlocks);
    if (view.type === 'project-chat')
      return projectMessages.flatMap(msgToNavBlocks);
    if (view.type === 'agent-session' && sessionData)
      return flattenSessionBlocks(sessionData.messages);
    return [];
  }, [view, messages, projectMessages, sessionData]);

  useEffect(() => {
    navBlocksRef.current = navBlocks;
  }, [navBlocks]);

  const pickerItems = useMemo(() => {
    if (overlay?.kind === 'teams') {
      return allTeams.filter((t) =>
        t.name.toLowerCase().includes(input.toLowerCase()),
      );
    }
    if (overlay?.kind === 'projects') {
      return projects.filter((p) =>
        p.name.toLowerCase().includes(input.toLowerCase()),
      );
    }
    if (overlay?.kind === 'agents') {
      return agents.filter((a) =>
        a.name.toLowerCase().includes(input.toLowerCase()),
      );
    }
    return [];
  }, [overlay, allTeams, projects, agents, input]);

  const mentionFilteredAgents = useMemo(() => {
    if (!overlay || overlay.kind !== 'mention') return [];
    return agents.filter((a) =>
      a.name.toLowerCase().includes(overlay.query.toLowerCase()),
    );
  }, [overlay, agents]);

  const workingAgents = agents.filter((a) => a.status === 'working');
  const isSending = sending || projectSending;

  // ── Polling effects ────────────────────────────────────────────────────

  // Poll team messages while a send is in-flight
  useEffect(() => {
    if (!sending) return;
    const id = setInterval(async () => {
      const [sessions, freshMessages] = await Promise.all([
        getStatusesFn({ data: { teamId } }),
        getMessagesFn({ data: { teamId } }),
      ]);
      setAgents((prev) => applySessionsToAgents(prev, sessions));
      setMessages(freshMessages);
    }, 1500);
    return () => clearInterval(id);
  }, [sending, teamId, getStatusesFn, getMessagesFn]);

  // Poll project messages while a project send is in-flight
  useEffect(() => {
    if (!projectSending || !currentProjectId) return;
    const projectId = currentProjectId;
    const id = setInterval(async () => {
      const [sessions, freshMsgs] = await Promise.all([
        getStatusesFn({ data: { teamId, projectId } }),
        getProjectMsgsFn({ data: { teamId, projectId } }),
      ]);
      setAgents((prev) => applySessionsToAgents(prev, sessions));
      setProjectMessages(freshMsgs as Message[]);
    }, 1500);
    return () => clearInterval(id);
  }, [
    projectSending,
    currentProjectId,
    teamId,
    getStatusesFn,
    getProjectMsgsFn,
  ]);

  // Load (and poll) agent session when view changes to agent-session
  useEffect(() => {
    if (view.type !== 'agent-session') return;
    const { agentName, projectId } = view;
    async function fetchSession() {
      const data = await getAgentSessionFn({
        data: { teamId, agentName, projectId },
      });
      setSessionData(data as SessionData);
    }
    fetchSession();
    if (selectedAgentStatus !== 'working') return;
    const id = setInterval(fetchSession, 2000);
    return () => clearInterval(id);
  }, [view, selectedAgentStatus, teamId, getAgentSessionFn]);

  // Load project messages when view switches to project-chat
  useEffect(() => {
    if (view.type !== 'project-chat') return;
    const { projectId } = view;
    getProjectMsgsFn({ data: { teamId, projectId } }).then((msgs) => {
      setProjectMessages(msgs as Message[]);
    });
  }, [view, teamId, getProjectMsgsFn]);

  // ── Async handlers ─────────────────────────────────────────────────────

  async function handleTeamSend(content: string) {
    setSending(true);
    const userMsg: Message = {
      id: crypto.randomUUID(),
      team_id: teamId,
      project_id: null,
      sender: 'user',
      content,
      mentions: '[]',
      created_at: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    try {
      await sendFn({ data: { teamId, content } });
      const [finalMessages, sessions] = await Promise.all([
        getMessagesFn({ data: { teamId } }),
        getStatusesFn({ data: { teamId } }),
      ]);
      setMessages(finalMessages);
      setAgents((prev) => applySessionsToAgents(prev, sessions));
    } finally {
      setSending(false);
    }
  }

  async function handleProjectSend(projectId: string, content: string) {
    setProjectSending(true);
    const userMsg: Message = {
      id: crypto.randomUUID(),
      team_id: teamId,
      project_id: projectId,
      sender: 'user',
      content,
      mentions: '[]',
      created_at: Date.now(),
    };
    setProjectMessages((prev) => [...prev, userMsg]);
    try {
      await sendProjectMsgFn({ data: { teamId, projectId, content } });
      const [finalMsgs, sessions] = await Promise.all([
        getProjectMsgsFn({ data: { teamId, projectId } }),
        getStatusesFn({ data: { teamId } }),
      ]);
      setProjectMessages(finalMsgs as Message[]);
      setAgents((prev) => applySessionsToAgents(prev, sessions));
    } finally {
      setProjectSending(false);
    }
  }

  function handleSend() {
    const content = input.trim();
    if (!content) return;
    setInput('');
    if (view.type === 'project-chat') {
      handleProjectSend(view.projectId, content);
    } else {
      handleTeamSend(content);
    }
  }

  // openPicker helpers (used in status-bar buttons and keydown handler)
  function openTeamsPicker() {
    setOverlay({ kind: 'teams', cursor: 0 });
    setInput('');
    setMode('insert');
    setFocusedIdx(-1);
  }

  function openProjectsPicker() {
    setOverlay({ kind: 'projects', cursor: 0 });
    setInput('');
    setMode('insert');
    setFocusedIdx(-1);
  }

  function openAgentsPicker() {
    setOverlay({ kind: 'agents', cursor: 0 });
    setInput('');
    setMode('insert');
    setFocusedIdx(-1);
  }

  // navigateBack: '-' key logic extracted so it can be called from the
  // global keydown handler that lives in $teamId.tsx
  function navigateBack() {
    if (view.type === 'chat') {
      navigate({ to: '/' });
    } else if (view.type === 'agent-session' && view.projectId) {
      setView({
        type: 'project-chat',
        projectId: view.projectId,
        projectName: view.projectName ?? '',
      });
    } else if (view.type === 'project-chat' || view.type === 'agent-session') {
      setView({ type: 'chat' });
    }
    setFocusedIdx(-1);
  }

  // navigateToTeam: called when user selects a team in the picker
  function navigateToTeam(teamName: string) {
    navigate({ to: '/teams/$teamId', params: { teamId: teamName } });
  }

  // handleInputChange: overlay/mention logic (extracted without DOM side-effects;
  // the component passes the event through and also handles DOM-specific stuff
  // like the textarea resize)
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setInput(value);

    const currentOverlay = overlayRef.current;

    // When a list picker is open, updating input resets cursor; no mention detection
    if (
      currentOverlay?.kind === 'teams' ||
      currentOverlay?.kind === 'projects' ||
      currentOverlay?.kind === 'agents'
    ) {
      setOverlay((ov) => (ov ? { ...ov, cursor: 0 } : ov));
      return;
    }
    if (currentOverlay?.kind === 'projects-create') return;

    // Mention detection
    const cursor = e.target.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const match = before.match(/@([\w-]*)$/);
    if (match) {
      const atStart = cursor - match[0].length;
      const query = match[1];
      setOverlay((prev) => ({
        kind: 'mention',
        atStart,
        query,
        cursor:
          prev?.kind === 'mention' && prev.query === query ? prev.cursor : 0,
      }));
    } else {
      setOverlay((prev) => (prev?.kind === 'mention' ? null : prev));
    }
  }

  // createProject handler (used in projects-create overlay Enter key)
  function handleCreateProject(name: string) {
    createProjectFn({ data: { teamId, name } }).then((p) => {
      setProjects((prev) => [...prev, p]);
    });
  }

  return {
    // State
    messages,
    setMessages,
    agents,
    setAgents,
    projects,
    setProjects,
    allTeams,
    setAllTeams,
    input,
    setInput,
    sending,
    setSending,
    mode,
    setMode,
    view,
    setView,
    overlay,
    setOverlay,
    focusedIdx,
    setFocusedIdx,
    projectMessages,
    setProjectMessages,
    projectSending,
    setProjectSending,
    sessionData,
    setSessionData,

    // Refs
    modeRef,
    viewRef,
    overlayRef,
    focusedIdxRef,
    navBlocksRef,

    // Derived
    currentProjectId,
    selectedAgentStatus,
    navBlocks,
    pickerItems,
    mentionFilteredAgents,
    workingAgents,
    isSending,

    // Handlers
    handleTeamSend,
    handleProjectSend,
    handleSend,
    handleInputChange,
    handleCreateProject,
    openTeamsPicker,
    openProjectsPicker,
    openAgentsPicker,
    navigateBack,
    navigateToTeam,
    navigate,
  };
}
