import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { Separator } from '~/components/ui/separator';
import type { Message } from '~/db/messages';
import type { Project } from '~/db/projects';
import { cn } from '~/lib/utils';
import {
  type AgentSessionMessage,
  createNewProject,
  getAgentSession,
  getAgentStatuses,
  getLatestMessages,
  getProjectMessages as getProjectMessagesFn,
  getTeamView,
  sendProjectMessage as sendProjectMessageFn,
  sendTeamMessage,
} from '~/server/team-data';
import type { TeamMeta } from '~/server/teams';
import { listTeams } from '~/server/teams';

export const Route = createFileRoute('/teams/$teamId')({
  loader: async ({ params }) => {
    const [teamView, teams] = await Promise.all([
      getTeamView({ data: { teamId: params.teamId } }),
      listTeams(),
    ]);
    return { ...teamView, teams };
  },
  component: TeamPage,
});

// ── Types ──────────────────────────────────────────────────────────────────

type AgentInfo = {
  name: string;
  isLead: boolean;
  status: 'idle' | 'working';
  statusText: string | null;
};

type SessionData = {
  messages: AgentSessionMessage[];
  status: 'idle' | 'working';
  statusText: string | null;
};

export type ViewState =
  | { type: 'chat' }
  | { type: 'project-chat'; projectId: string; projectName: string }
  | { type: 'agent-session'; agentName: string };

type OverlayState =
  | { kind: 'teams'; cursor: number }
  | { kind: 'projects'; cursor: number }
  | { kind: 'projects-create' }
  | { kind: 'agents'; cursor: number }
  | { kind: 'mention'; atStart: number; query: string; cursor: number };

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; content: unknown }
  | { type: string; [key: string]: unknown };

type NavBlock =
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

// ── Breadcrumb ─────────────────────────────────────────────────────────────

export function Breadcrumb({
  view,
  teamId,
}: {
  view: ViewState;
  teamId: string;
}) {
  switch (view.type) {
    case 'chat':
      return <span className="text-primary">~/{teamId}</span>;
    case 'project-chat':
      return (
        <>
          <span className="text-primary">~/{teamId}</span>
          <span className="text-secondary ml-1">({view.projectName})</span>
        </>
      );
    case 'agent-session':
      return (
        <span className="text-primary">
          ~/{teamId}/{view.agentName}
        </span>
      );
  }
}

// ── Markdown ───────────────────────────────────────────────────────────────

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

// ── Helpers ────────────────────────────────────────────────────────────────

function flattenSessionBlocks(messages: AgentSessionMessage[]): NavBlock[] {
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

function navBlockText(b: NavBlock): string {
  if (b.kind === 'chat') return b.content;
  if (b.kind === 'session' && b.block.type === 'text')
    return (b.block as { type: 'text'; text: string }).text;
  if (b.kind === 'session' && b.block.type === 'thinking')
    return (b.block as { type: 'thinking'; thinking: string }).thinking;
  return '';
}

// ── Main component ─────────────────────────────────────────────────────────

function TeamPage() {
  const initialData = Route.useLoaderData();
  const { teamId } = Route.useParams();
  const navigate = useNavigate();

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

  const modeRef = useRef(mode);
  const viewRef = useRef(view);
  const overlayRef = useRef(overlay);
  const focusedIdxRef = useRef(focusedIdx);
  const navBlocksRef = useRef<NavBlock[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasInitialScrolled = useRef(false);

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

  const sendFn = useServerFn(sendTeamMessage);
  const getStatusesFn = useServerFn(getAgentStatuses);
  const getAgentSessionFn = useServerFn(getAgentSession);
  const getMessagesFn = useServerFn(getLatestMessages);
  const getProjectMsgsFn = useServerFn(getProjectMessagesFn);
  const sendProjectMsgFn = useServerFn(sendProjectMessageFn);
  const createProjectFn = useServerFn(createNewProject);

  function msgToNavBlocks(m: Message): NavBlock[] {
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: msgToNavBlocks and flattenSessionBlocks are stable
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

  const showInlinePicker =
    overlay !== null &&
    overlay.kind !== 'projects-create' &&
    (overlay.kind !== 'mention' || mentionFilteredAgents.length > 0);

  const currentProjectId = view.type === 'project-chat' ? view.projectId : null;

  const selectedAgentStatus =
    view.type === 'agent-session'
      ? (agents.find(
          (a) =>
            a.name ===
            (view as { type: 'agent-session'; agentName: string }).agentName,
        )?.status ?? 'idle')
      : 'idle';

  useEffect(() => {
    if (!sending) return;
    const id = setInterval(async () => {
      const [sessions, freshMessages] = await Promise.all([
        getStatusesFn({ data: { teamId } }),
        getMessagesFn({ data: { teamId } }),
      ]);
      setAgents((prev) =>
        prev.map((a) => {
          const s = sessions.find((s) => s.agent_name === a.name);
          return s ? { ...a, status: s.status, statusText: s.status_text } : a;
        }),
      );
      setMessages(freshMessages);
    }, 1500);
    return () => clearInterval(id);
  }, [sending, teamId, getStatusesFn, getMessagesFn]);

  useEffect(() => {
    if (!projectSending || !currentProjectId) return;
    const projectId = currentProjectId;
    const id = setInterval(async () => {
      const [sessions, freshMsgs] = await Promise.all([
        getStatusesFn({ data: { teamId, projectId } }),
        getProjectMsgsFn({ data: { teamId, projectId } }),
      ]);
      setAgents((prev) =>
        prev.map((a) => {
          const s = sessions.find((s) => s.agent_name === a.name);
          return s ? { ...a, status: s.status, statusText: s.status_text } : a;
        }),
      );
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

  useEffect(() => {
    if (view.type !== 'agent-session') return;
    const { agentName } = view;
    async function fetchSession() {
      const data = await getAgentSessionFn({ data: { teamId, agentName } });
      setSessionData(data as SessionData);
      setTimeout(
        () => bottomRef.current?.scrollIntoView({ behavior: 'instant' }),
        50,
      );
    }
    fetchSession();
    if (selectedAgentStatus !== 'working') return;
    const id = setInterval(fetchSession, 2000);
    return () => clearInterval(id);
  }, [view, selectedAgentStatus, teamId, getAgentSessionFn]);

  useEffect(() => {
    if (view.type !== 'project-chat') return;
    const { projectId } = view;
    getProjectMsgsFn({ data: { teamId, projectId } }).then((msgs) => {
      setProjectMessages(msgs as Message[]);
      setTimeout(
        () => bottomRef.current?.scrollIntoView({ behavior: 'instant' }),
        50,
      );
    });
  }, [view, teamId, getProjectMsgsFn]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: messages/projectMessages trigger scroll
  useEffect(() => {
    const behavior = hasInitialScrolled.current ? 'smooth' : 'instant';
    hasInitialScrolled.current = true;
    bottomRef.current?.scrollIntoView({ behavior });
  }, [messages, projectMessages]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: input triggers DOM scrollHeight recalc
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

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
      setAgents((prev) =>
        prev.map((a) => {
          const s = sessions.find((s) => s.agent_name === a.name);
          return s ? { ...a, status: s.status, statusText: s.status_text } : a;
        }),
      );
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
      setAgents((prev) =>
        prev.map((a) => {
          const s = sessions.find((s) => s.agent_name === a.name);
          return s ? { ...a, status: s.status, statusText: s.status_text } : a;
        }),
      );
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

  function insertMention(name: string, atStart: number) {
    const textarea = inputRef.current;
    if (!textarea) return;
    const cursorEnd = textarea.selectionStart ?? input.length;
    const newText = `${input.slice(0, atStart)}@${name} ${input.slice(cursorEnd)}`;
    setInput(newText);
    const newCursor = atStart + name.length + 2;
    requestAnimationFrame(() =>
      textarea.setSelectionRange(newCursor, newCursor),
    );
  }

  function closePicker() {
    setInput('');
    setOverlay(null);
    setMode('normal');
    inputRef.current?.blur();
  }

  // ── Global keyboard handler ───────────────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const currentMode = modeRef.current;
      const currentView = viewRef.current;
      const currentOverlay = overlayRef.current;
      const currentFocused = focusedIdxRef.current;
      const blocks = navBlocksRef.current;

      if (currentMode === 'insert') {
        if (e.key === 'Escape') {
          if (currentOverlay?.kind === 'mention') {
            setOverlay(null);
          } else if (
            currentOverlay?.kind === 'teams' ||
            currentOverlay?.kind === 'projects' ||
            currentOverlay?.kind === 'agents'
          ) {
            setInput('');
            setOverlay(null);
            setMode('normal');
            inputRef.current?.blur();
          } else if (currentOverlay?.kind === 'projects-create') {
            // Back to projects list
            setOverlay({ kind: 'projects', cursor: 0 });
            setInput('');
          } else {
            setMode('normal');
            inputRef.current?.blur();
          }
          e.preventDefault();
        }
        return;
      }

      // Normal mode: block global shortcuts while overlay is open
      if (currentOverlay !== null) return;

      switch (e.key) {
        case 'i':
          setMode('insert');
          inputRef.current?.focus();
          e.preventDefault();
          break;

        case 'p':
          setOverlay({ kind: 'projects', cursor: 0 });
          setInput('');
          setMode('insert');
          inputRef.current?.focus();
          setFocusedIdx(-1);
          e.preventDefault();
          break;

        case 'a':
          setOverlay({ kind: 'agents', cursor: 0 });
          setInput('');
          setMode('insert');
          inputRef.current?.focus();
          setFocusedIdx(-1);
          e.preventDefault();
          break;

        case 't':
          setOverlay({ kind: 'teams', cursor: 0 });
          setInput('');
          setMode('insert');
          inputRef.current?.focus();
          setFocusedIdx(-1);
          e.preventDefault();
          break;

        case '-': {
          if (currentView.type === 'chat') {
            navigate({ to: '/' });
          } else if (
            currentView.type === 'project-chat' ||
            currentView.type === 'agent-session'
          ) {
            setView({ type: 'chat' });
          }
          setFocusedIdx(-1);
          e.preventDefault();
          break;
        }

        case 'j': {
          setFocusedIdx((f) =>
            f < 0 ? 0 : Math.min(f + 1, blocks.length - 1),
          );
          e.preventDefault();
          break;
        }

        case 'k': {
          setFocusedIdx((f) =>
            f < 0 ? blocks.length - 1 : Math.max(f - 1, 0),
          );
          e.preventDefault();
          break;
        }

        case 'y': {
          if (currentFocused >= 0 && blocks[currentFocused]) {
            const text = navBlockText(blocks[currentFocused]);
            if (text) {
              const quoted = text
                .split('\n')
                .map((line) => `> ${line}`)
                .join('\n');
              setInput(`${quoted}\n`);
            }
          }
          e.preventDefault();
          break;
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  // ── Input change ──────────────────────────────────────────────────────────
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setInput(value);

    const currentOverlay = overlayRef.current;

    // When a list picker is open, update resets cursor; no mention detection
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
    const match = before.match(/@(\w*)$/);
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

  // ── Input keydown ─────────────────────────────────────────────────────────
  function handleInputKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Teams picker
    if (overlay?.kind === 'teams') {
      const filtered = pickerItems as TeamMeta[];
      if (e.key === 'ArrowDown') {
        setOverlay((ov) =>
          ov?.kind === 'teams'
            ? {
                ...ov,
                cursor: Math.min(
                  ov.cursor + 1,
                  Math.max(filtered.length - 1, 0),
                ),
              }
            : ov,
        );
        e.preventDefault();
        return;
      }
      if (e.key === 'ArrowUp') {
        setOverlay((ov) =>
          ov?.kind === 'teams'
            ? { ...ov, cursor: Math.max(ov.cursor - 1, 0) }
            : ov,
        );
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const team = filtered[overlay.cursor];
        if (team) {
          closePicker();
          navigate({ to: '/teams/$teamId', params: { teamId: team.name } });
        }
        e.preventDefault();
        return;
      }
      return;
    }

    // Projects picker
    if (overlay?.kind === 'projects') {
      const filtered = pickerItems as Project[];
      const maxCursor = filtered.length; // filtered.length == "+ new project" row

      if (e.key === 'ArrowDown') {
        setOverlay((ov) =>
          ov?.kind === 'projects'
            ? { ...ov, cursor: Math.min(ov.cursor + 1, maxCursor) }
            : ov,
        );
        e.preventDefault();
        return;
      }
      if (e.key === 'ArrowUp') {
        setOverlay((ov) =>
          ov?.kind === 'projects'
            ? { ...ov, cursor: Math.max(ov.cursor - 1, 0) }
            : ov,
        );
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const cur = overlay.cursor;
        if (cur < filtered.length) {
          const p = filtered[cur];
          setView({
            type: 'project-chat',
            projectId: p.id,
            projectName: p.name,
          });
          setFocusedIdx(-1);
          closePicker();
        } else {
          // "+ new project" row
          setOverlay({ kind: 'projects-create' });
          setInput('');
        }
        e.preventDefault();
        return;
      }
      return;
    }

    // Agents picker
    if (overlay?.kind === 'agents') {
      const filtered = pickerItems as AgentInfo[];
      if (e.key === 'ArrowDown') {
        setOverlay((ov) =>
          ov?.kind === 'agents'
            ? {
                ...ov,
                cursor: Math.min(
                  ov.cursor + 1,
                  Math.max(filtered.length - 1, 0),
                ),
              }
            : ov,
        );
        e.preventDefault();
        return;
      }
      if (e.key === 'ArrowUp') {
        setOverlay((ov) =>
          ov?.kind === 'agents'
            ? { ...ov, cursor: Math.max(ov.cursor - 1, 0) }
            : ov,
        );
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const ag = filtered[overlay.cursor];
        if (ag) {
          setView({ type: 'agent-session', agentName: ag.name });
          setSessionData(null);
          setFocusedIdx(-1);
          closePicker();
        }
        e.preventDefault();
        return;
      }
      return;
    }

    // Projects create mode
    if (overlay?.kind === 'projects-create') {
      if (e.key === 'Enter' && !e.shiftKey) {
        if (input.trim()) {
          const name = input.trim();
          createProjectFn({ data: { teamId, name } }).then((p) => {
            setProjects((prev) => [...prev, p]);
          });
          closePicker();
        }
        e.preventDefault();
        return;
      }
      return;
    }

    // Mention picker
    if (overlay?.kind === 'mention') {
      const filtered = mentionFilteredAgents;
      if (e.key === 'ArrowDown') {
        setOverlay((ov) =>
          ov?.kind === 'mention'
            ? {
                ...ov,
                cursor: Math.min(
                  ov.cursor + 1,
                  Math.max(filtered.length - 1, 0),
                ),
              }
            : ov,
        );
        e.preventDefault();
        return;
      }
      if (e.key === 'ArrowUp') {
        setOverlay((ov) =>
          ov?.kind === 'mention'
            ? { ...ov, cursor: Math.max(ov.cursor - 1, 0) }
            : ov,
        );
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const selected = filtered[overlay.cursor];
        if (selected) insertMention(selected.name, overlay.atStart);
        setOverlay(null);
        e.preventDefault();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const workingAgents = agents.filter((a) => a.status === 'working');
  const isSending = sending || projectSending;
  const inputDisabled = isSending || view.type === 'agent-session';

  const inputPlaceholder =
    overlay?.kind === 'projects-create'
      ? 'project name...'
      : overlay?.kind === 'teams' ||
          overlay?.kind === 'projects' ||
          overlay?.kind === 'agents'
        ? 'filter...'
        : undefined;

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden font-mono">
      {/* ── Content area ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0 flex flex-col">
        {view.type === 'chat' && (
          <ChatView
            navBlocks={navBlocks}
            focusedIdx={focusedIdx}
            onFocusBlock={setFocusedIdx}
            bottomRef={bottomRef}
          />
        )}
        {view.type === 'project-chat' && (
          <ChatView
            navBlocks={navBlocks}
            focusedIdx={focusedIdx}
            onFocusBlock={setFocusedIdx}
            bottomRef={bottomRef}
            emptyText={`No messages in ${view.projectName} yet.`}
          />
        )}
        {view.type === 'agent-session' && (
          <AgentSessionView
            agentName={view.agentName}
            navBlocks={navBlocks}
            focusedIdx={focusedIdx}
            onFocusBlock={setFocusedIdx}
            bottomRef={bottomRef}
          />
        )}
      </div>

      {/* ── Working agent indicator ─────────────────────────────────────── */}
      {workingAgents.length > 0 && (
        <div className="px-4 pt-1.5 pb-0.5 flex flex-col gap-0.5">
          {workingAgents.map((a) => (
            <div
              key={a.name}
              className="text-xs flex gap-1.5 items-baseline truncate"
            >
              <span className="text-secondary shrink-0">{a.name}</span>
              <span className="text-muted-foreground shrink-0">(c)</span>
              {a.statusText && (
                <span className="text-muted-foreground/60 italic truncate">
                  {a.statusText}...
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Input area ──────────────────────────────────────────────────── */}
      <div className="shrink-0">
        <Separator />
        <div className="px-4 pt-1.5 pb-2">
          <div className="text-xs mb-1 select-none">
            {overlay?.kind === 'projects-create' ? (
              <span>
                <span className="text-foreground/60">new project</span>
                <span className="text-muted-foreground/30 ml-2">
                  esc to cancel
                </span>
              </span>
            ) : (
              <Breadcrumb view={view} teamId={teamId} />
            )}
          </div>

          {/* Inline picker list — sits between breadcrumb and prompt */}
          {showInlinePicker && overlay && (
            <InlinePicker
              overlay={overlay}
              pickerItems={pickerItems}
              mentionItems={mentionFilteredAgents}
              onSelectTeam={(team) => {
                closePicker();
                navigate({
                  to: '/teams/$teamId',
                  params: { teamId: team.name },
                });
              }}
              onSelectProject={(p) => {
                setView({
                  type: 'project-chat',
                  projectId: p.id,
                  projectName: p.name,
                });
                setFocusedIdx(-1);
                closePicker();
              }}
              onSelectAgent={(ag) => {
                setView({ type: 'agent-session', agentName: ag.name });
                setSessionData(null);
                setFocusedIdx(-1);
                closePicker();
              }}
              onSelectMention={(agent) => {
                if (overlay?.kind === 'mention')
                  insertMention(agent.name, overlay.atStart);
                setOverlay(null);
                inputRef.current?.focus();
              }}
              onCreateProject={() => {
                setOverlay({ kind: 'projects-create' });
                setInput('');
              }}
            />
          )}

          <div className="flex items-start gap-1.5">
            <span className="text-muted-foreground/30 text-sm shrink-0 mt-px select-none leading-relaxed">
              ❯❯⎽
            </span>
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onFocus={() => setMode('insert')}
              onBlur={() => setMode('normal')}
              onKeyDown={handleInputKeyDown}
              disabled={inputDisabled}
              placeholder={inputDisabled ? '' : inputPlaceholder}
              rows={1}
              className={cn(
                'flex-1 bg-transparent border-none resize-none outline-none text-sm leading-relaxed',
                'text-foreground placeholder:text-muted-foreground/40 overflow-hidden',
                inputDisabled && 'opacity-40 cursor-default',
              )}
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* ── Status bar ─────────────────────────────────────────────────── */}
      <div className="px-4 py-1 shrink-0 flex items-center gap-1 text-xs">
        <button
          type="button"
          onClick={() => {
            setOverlay({ kind: 'teams', cursor: 0 });
            setInput('');
            setMode('insert');
            inputRef.current?.focus();
            setFocusedIdx(-1);
          }}
          className="text-muted-foreground/50 hover:text-primary hover:underline"
        >
          teams
        </button>
        <span className="text-muted-foreground/30 ml-0.5">(t)</span>
        <button
          type="button"
          onClick={() => {
            setOverlay({ kind: 'projects', cursor: 0 });
            setInput('');
            setMode('insert');
            inputRef.current?.focus();
            setFocusedIdx(-1);
          }}
          className="text-primary hover:underline ml-3"
        >
          {projects.length} projects
        </button>
        <span className="text-muted-foreground ml-0.5">(p)</span>
        <button
          type="button"
          onClick={() => {
            setOverlay({ kind: 'agents', cursor: 0 });
            setInput('');
            setMode('insert');
            inputRef.current?.focus();
            setFocusedIdx(-1);
          }}
          className="text-primary hover:underline ml-3"
        >
          {agents.length} agents
        </button>
        <span className="text-muted-foreground ml-0.5">(a)</span>
        {mode === 'normal' && (
          <span className="ml-auto text-muted-foreground/50">NORMAL</span>
        )}
      </div>
    </div>
  );
}

// ── InlinePicker ───────────────────────────────────────────────────────────

function InlinePicker({
  overlay,
  pickerItems,
  mentionItems,
  onSelectTeam,
  onSelectProject,
  onSelectAgent,
  onSelectMention,
  onCreateProject,
}: {
  overlay: OverlayState;
  pickerItems: TeamMeta[] | Project[] | AgentInfo[];
  mentionItems: AgentInfo[];
  onSelectTeam: (team: TeamMeta) => void;
  onSelectProject: (p: Project) => void;
  onSelectAgent: (ag: AgentInfo) => void;
  onSelectMention: (agent: AgentInfo) => void;
  onCreateProject: () => void;
}) {
  const cursor = 'cursor' in overlay ? overlay.cursor : 0;

  if (overlay.kind === 'teams') {
    const teams = pickerItems as TeamMeta[];
    return (
      <div className="border-t border-border/20 -mx-4 mb-2 max-h-48 overflow-y-auto">
        {teams.length === 0 && (
          <div className="px-4 py-0.5 text-sm text-muted-foreground/50 italic font-mono">
            (no matches)
          </div>
        )}
        {teams.map((team, i) => (
          <button
            key={team.name}
            type="button"
            onClick={() => onSelectTeam(team)}
            className={cn(
              'flex items-baseline justify-between text-left w-full px-4 py-0.5 text-sm font-mono transition-colors',
              i === cursor
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-accent/40',
            )}
          >
            <span className="text-foreground">{team.name}/</span>
            <span className="text-xs ml-4 text-muted-foreground/60">
              {team.lead} +{team.members.length}
            </span>
          </button>
        ))}
      </div>
    );
  }

  if (overlay.kind === 'mention') {
    return (
      <div className="border-t border-border/20 -mx-4 mb-2 max-h-40 overflow-y-auto">
        {(mentionItems as AgentInfo[]).map((agent, i) => (
          <button
            key={agent.name}
            type="button"
            onClick={() => onSelectMention(agent)}
            className={cn(
              'flex items-baseline gap-3 text-left w-full px-4 py-0.5 text-sm font-mono transition-colors',
              i === cursor
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-accent/40',
            )}
          >
            <span
              className={cn(
                agent.status === 'working'
                  ? 'text-secondary'
                  : 'text-foreground',
              )}
            >
              @{agent.name}
            </span>
            {agent.status === 'working' && (
              <span className="text-xs text-secondary/70">working</span>
            )}
          </button>
        ))}
      </div>
    );
  }

  const isProjects = overlay.kind === 'projects';
  const items = pickerItems as (Project | AgentInfo | TeamMeta)[];
  const createHighlighted = isProjects && cursor === items.length;

  return (
    <div className="border-t border-border/20 -mx-4 mb-2 max-h-48 overflow-y-auto">
      {items.length === 0 && (
        <div className="px-4 py-0.5 text-sm text-muted-foreground/50 italic font-mono">
          (no matches)
        </div>
      )}
      {items.map((item, i) => {
        const isCursor = i === cursor && !createHighlighted;
        if (isProjects) {
          const p = item as Project;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelectProject(p)}
              className={cn(
                'flex items-baseline justify-between text-left w-full px-4 py-0.5 text-sm font-mono transition-colors',
                isCursor
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/40',
              )}
            >
              <span className="text-foreground">{p.name}</span>
              <span className="text-xs ml-4 text-muted-foreground/60">
                {p.status}
              </span>
            </button>
          );
        }
        const ag = item as AgentInfo;
        return (
          <button
            key={ag.name}
            type="button"
            onClick={() => onSelectAgent(ag)}
            className={cn(
              'flex items-baseline justify-between text-left w-full px-4 py-0.5 text-sm font-mono transition-colors',
              isCursor
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-accent/40',
            )}
          >
            <span
              className={cn(
                ag.status === 'working' ? 'text-secondary' : 'text-foreground',
              )}
            >
              {ag.name}
            </span>
            <span
              className={cn(
                'text-xs ml-4',
                ag.status === 'working'
                  ? 'text-secondary/70'
                  : 'text-muted-foreground/60',
              )}
            >
              {ag.status === 'working'
                ? `working — ${ag.statusText ?? '...'}`
                : 'idle'}
            </span>
          </button>
        );
      })}
      {isProjects && (
        <button
          type="button"
          onClick={onCreateProject}
          className={cn(
            'flex items-center gap-1 text-left w-full px-4 py-0.5 text-sm font-mono transition-colors border-t border-border/20',
            createHighlighted
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground/50 hover:text-primary hover:bg-accent/40',
          )}
        >
          + new project
        </button>
      )}
    </div>
  );
}

// ── ChatView ───────────────────────────────────────────────────────────────

function ChatView({
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

// ── AgentSessionView ───────────────────────────────────────────────────────

function AgentSessionView({
  agentName,
  navBlocks,
  focusedIdx,
  onFocusBlock,
  bottomRef,
}: {
  agentName: string;
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

function SessionBlockContent({ block }: { block: ContentBlock }) {
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
