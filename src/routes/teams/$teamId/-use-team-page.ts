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
 *   - All state (messages, agents, projects, allTeams, input, sending, mode,
 *     overlay, focusedIdx, projectMessages, projectSending, sessionData)
 *   - modeRef / routeCtxRef / overlayRef / focusedIdxRef (kept in sync via effects)
 *   - navBlocksRef + navBlocks useMemo
 *   - pickerItems / mentionFilteredAgents useMemos
 *   - selectedAgentStatus / workingAgents / currentProjectId derived values
 *   - All async send / load handlers (handleTeamSend, handleProjectSend, handleSend)
 *   - Server-fn polling effects (team send, project send, agent session)
 *   - project-chat message load effect (on routeCtx change)
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

export type OverlayState =
  | { kind: 'teams'; cursor: number }
  | { kind: 'projects'; cursor: number }
  | { kind: 'projects-create' }
  | { kind: 'agents'; cursor: number }
  | { kind: 'mention'; atStart: number; query: string; cursor: number };

// Route context: which project/agent is currently shown (derived from URL).
export type TeamRouteContext = {
  currentProjectName?: string;
  currentAgentName?: string;
  isFilesView?: boolean;
  isDiffView?: boolean;
};

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

export function useTeamPage(
  initialData: TeamPageLoaderData,
  routeCtx: TeamRouteContext = {},
) {
  const { teamId } = initialData;
  const { currentProjectName, currentAgentName } = routeCtx;
  const navigate = useNavigate();

  // ── State ──────────────────────────────────────────────────────────────

  const [messages, setMessages] = useState<Message[]>(initialData.messages);
  const [agents, setAgents] = useState<AgentInfo[]>(initialData.agents);
  const [projects, setProjects] = useState<Project[]>(initialData.projects);
  const [allTeams, setAllTeams] = useState<TeamMeta[]>(initialData.teams);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const [mode, setMode] = useState<'insert' | 'normal'>('normal');
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const [focusedIdx, setFocusedIdx] = useState(-1);

  const [projectMessages, setProjectMessages] = useState<Message[]>([]);
  const [projectSending, setProjectSending] = useState(false);
  const [sessionData, setSessionData] = useState<SessionData | null>(null);

  // Sync state when navigating to a different team (loader returns new data
  // but the component is reused, so useState initializers don't re-run).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally sync all team state when teamId changes
  useEffect(() => {
    setMessages(initialData.messages);
    setAgents(initialData.agents);
    setProjects(initialData.projects);
    setAllTeams(initialData.teams);
    setOverlay(null);
    setFocusedIdx(-1);
    setSessionData(null);
    setProjectMessages([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  // ── Refs (kept in sync via effects; used inside global keydown handler) ─

  const modeRef = useRef(mode);
  const routeCtxRef = useRef(routeCtx);
  const overlayRef = useRef(overlay);
  const focusedIdxRef = useRef(focusedIdx);
  const navBlocksRef = useRef<NavBlock[]>([]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    routeCtxRef.current = routeCtx;
  }, [routeCtx]);
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

  // Look up current project by name from projects list
  const currentProject = currentProjectName
    ? projects.find((p) => p.name === currentProjectName)
    : undefined;
  const currentProjectId = currentProject?.id;

  const selectedAgentStatus = currentAgentName
    ? (agents.find((a) => a.name === currentAgentName)?.status ?? 'idle')
    : 'idle';

  const navBlocks: NavBlock[] = useMemo(() => {
    if (currentAgentName && sessionData)
      return flattenSessionBlocks(sessionData.messages);
    if (currentProjectId) return projectMessages.flatMap(msgToNavBlocks);
    return messages.flatMap(msgToNavBlocks);
  }, [
    currentAgentName,
    currentProjectId,
    messages,
    projectMessages,
    sessionData,
  ]);

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

  // Load (and poll) agent session when in agent context
  useEffect(() => {
    if (!currentAgentName) return;
    const agentName = currentAgentName;
    const projectId = currentProjectId;
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
  }, [
    currentAgentName,
    currentProjectId,
    selectedAgentStatus,
    teamId,
    getAgentSessionFn,
  ]);

  // Load project messages when entering a project view
  useEffect(() => {
    if (!currentProjectId) {
      setProjectMessages([]);
      return;
    }
    const projectId = currentProjectId;
    getProjectMsgsFn({ data: { teamId, projectId } }).then((msgs) => {
      setProjectMessages(msgs as Message[]);
    });
  }, [currentProjectId, teamId, getProjectMsgsFn]);

  // Reset session data when leaving agent view
  useEffect(() => {
    if (!currentAgentName) {
      setSessionData(null);
    }
  }, [currentAgentName]);

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
    // Look up project by name to get its ID for sending
    const project = currentProjectName
      ? projects.find((p) => p.name === currentProjectName)
      : null;
    if (project) {
      handleProjectSend(project.id, content);
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

  // navigateBack: '-' key logic — uses routeCtxRef to avoid stale closures
  function navigateBack() {
    const ctx = routeCtxRef.current;
    if (ctx.currentAgentName && ctx.currentProjectName) {
      // From agent session within a project → back to project chat
      navigate({
        to: '/teams/$teamId/projects/$projectName',
        params: { teamId, projectName: ctx.currentProjectName },
      });
    } else if (ctx.currentProjectName || ctx.currentAgentName) {
      // From project chat or standalone agent → back to team chat
      navigate({ to: '/teams/$teamId', params: { teamId } });
    } else {
      // From team chat → back to home
      navigate({ to: '/' });
    }
    setFocusedIdx(-1);
  }

  // navigateToTeam: called when user selects a team in the picker
  function navigateToTeam(teamName: string) {
    navigate({ to: '/teams/$teamId', params: { teamId: teamName } });
  }

  // handleInputChange: overlay/mention logic
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
    routeCtxRef,
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
