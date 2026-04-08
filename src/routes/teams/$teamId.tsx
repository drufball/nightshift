import { createFileRoute } from '@tanstack/react-router';
import type React from 'react';
import { useEffect, useRef } from 'react';
import { Separator } from '~/components/ui/separator';
import type { Project } from '~/db/projects';
import type { AgentSession } from '~/db/sessions';
import { cn } from '~/lib/utils';
import { getTeamView } from '~/server/team-data';
import type { TeamMeta } from '~/server/teams';
import { listTeams } from '~/server/teams';
import { AgentSessionView } from './$teamId/agent-session-view';
import { Breadcrumb } from './$teamId/breadcrumb';
import { ChatView } from './$teamId/chat-view';
import { navBlockText } from './$teamId/nav-blocks';
import {
  type AgentInfo,
  type OverlayState,
  type ViewState,
  useTeamPage,
} from './$teamId/use-team-page';

// Re-export for test compatibility
export { Breadcrumb };

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

// ── Types re-exported for test compatibility ────────────────────────────────
export type { ViewState } from './$teamId/use-team-page';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Pure helper: merge the latest session statuses into the agent list. */
export function applySessionsToAgents(
  agents: AgentInfo[],
  sessions: AgentSession[],
): AgentInfo[] {
  return agents.map((a) => {
    const s = sessions.find((s) => s.agent_name === a.name);
    return s ? { ...a, status: s.status, statusText: s.status_text } : a;
  });
}

// Suppress unused import warning – AgentSessionMessage type is used by SessionData
// inside use-team-page.ts; re-export keeps the import live here.
export type { AgentInfo, OverlayState };

// ── Main component ─────────────────────────────────────────────────────────

function TeamPage() {
  const initialData = Route.useLoaderData();
  const { teamId } = Route.useParams();

  const {
    messages,
    agents,
    projects,
    input,
    setInput,
    sending,
    mode,
    setMode,
    view,
    setView,
    overlay,
    setOverlay,
    focusedIdx,
    setFocusedIdx,
    projectMessages,
    projectSending,
    sessionData,
    setSessionData,
    modeRef,
    viewRef,
    overlayRef,
    focusedIdxRef,
    navBlocksRef,
    navBlocks,
    pickerItems,
    mentionFilteredAgents,
    workingAgents,
    isSending,
    handleSend,
    handleInputChange,
    handleCreateProject,
    openTeamsPicker,
    openProjectsPicker,
    openAgentsPicker,
    navigateBack,
    navigateToTeam,
    navigate,
  } = useTeamPage({ ...initialData, teamId });

  // ── DOM-only refs (tightly coupled to JSX) ─────────────────────────────────
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasInitialScrolled = useRef(false);

  // Scroll to bottom when messages change
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages/projectMessages trigger scroll
  useEffect(() => {
    const behavior = hasInitialScrolled.current ? 'smooth' : 'instant';
    hasInitialScrolled.current = true;
    bottomRef.current?.scrollIntoView({ behavior });
  }, [messages, projectMessages]);

  // Auto-resize textarea
  // biome-ignore lint/correctness/useExhaustiveDependencies: input triggers DOM scrollHeight recalc
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // Scroll to bottom after agent session loads
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionData triggers scroll
  useEffect(() => {
    if (view.type !== 'agent-session') return;
    if (sessionData) {
      setTimeout(
        () => bottomRef.current?.scrollIntoView({ behavior: 'instant' }),
        50,
      );
    }
  }, [sessionData]);

  // Scroll to bottom after project messages load
  // biome-ignore lint/correctness/useExhaustiveDependencies: projectMessages triggers scroll
  useEffect(() => {
    if (view.type !== 'project-chat') return;
    if (projectMessages.length > 0) {
      setTimeout(
        () => bottomRef.current?.scrollIntoView({ behavior: 'instant' }),
        50,
      );
    }
  }, [view]);

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: handler intentionally reads latest state via refs; only navigate triggers re-registration
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
          openProjectsPicker();
          inputRef.current?.focus();
          e.preventDefault();
          break;

        case 'a':
          openAgentsPicker();
          inputRef.current?.focus();
          e.preventDefault();
          break;

        case 't':
          openTeamsPicker();
          inputRef.current?.focus();
          e.preventDefault();
          break;

        case '-': {
          navigateBack();
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
          const projectCtx =
            'projectId' in view
              ? { projectId: view.projectId, projectName: view.projectName }
              : {};
          setView({ type: 'agent-session', agentName: ag.name, ...projectCtx });
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
          handleCreateProject(input.trim());
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

  const inputDisabled = isSending || view.type === 'agent-session';

  const showInlinePicker =
    overlay !== null &&
    overlay.kind !== 'projects-create' &&
    (overlay.kind !== 'mention' || mentionFilteredAgents.length > 0);

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
                navigateToTeam(team.name);
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
                const projectCtx =
                  'projectId' in view
                    ? {
                        projectId: view.projectId,
                        projectName: view.projectName,
                      }
                    : {};
                setView({
                  type: 'agent-session',
                  agentName: ag.name,
                  ...projectCtx,
                });
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
            openTeamsPicker();
            inputRef.current?.focus();
          }}
          className="text-muted-foreground/50 hover:text-primary hover:underline"
        >
          teams
        </button>
        <span className="text-muted-foreground/30 ml-0.5">(t)</span>
        <button
          type="button"
          onClick={() => {
            openProjectsPicker();
            inputRef.current?.focus();
          }}
          className="text-primary hover:underline ml-3"
        >
          {projects.length} projects
        </button>
        <span className="text-muted-foreground ml-0.5">(p)</span>
        <button
          type="button"
          onClick={() => {
            openAgentsPicker();
            inputRef.current?.focus();
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
