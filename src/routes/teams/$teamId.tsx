import { Outlet, createFileRoute, useMatches } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import type React from 'react';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Separator } from '~/components/ui/separator';
import type { Project } from '~/db/projects';
import type { AgentSession } from '~/db/sessions';
import { cn } from '~/lib/utils';
import {
  type DiffStats,
  type FileEntry,
  getProjectDiffFn as getProjectDiffServerFn,
  getTeamFileContent,
  getTeamFiles,
} from '~/server/artefacts';
import { getTeamView } from '~/server/team-data';
import type { TeamMeta } from '~/server/teams';
import { listTeams } from '~/server/teams';
import { AgentSessionView } from './$teamId/-agent-session-view';
import { Breadcrumb } from './$teamId/-breadcrumb';
import { DiffView } from './$teamId/-diff-view';
import { FileContentView } from './$teamId/-file-content-view';
import { FilesView } from './$teamId/-files-view';
import { InlinePicker } from './$teamId/-inline-picker';
import { navBlockText } from './$teamId/-nav-blocks';
import type { NavBlock } from './$teamId/-nav-blocks';
import {
  type AgentInfo,
  type OverlayState,
  type SessionData,
  useTeamPage,
} from './$teamId/-use-team-page';

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
// ViewState is no longer used internally — kept only for external callers
export type ViewState =
  | { type: 'chat' }
  | { type: 'project-chat'; projectId: string; projectName: string }
  | {
      type: 'agent-session';
      agentName: string;
      projectId?: string;
      projectName?: string;
    };

// ── React Context (shared between layout and child routes) ─────────────────

export type TeamPageContextType = {
  navBlocks: NavBlock[];
  focusedIdx: number;
  setFocusedIdx: React.Dispatch<React.SetStateAction<number>>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
};

export const TeamPageContext = createContext<TeamPageContextType | null>(null);

export function useTeamPageContext() {
  const ctx = useContext(TeamPageContext);
  if (!ctx) throw new Error('useTeamPageContext must be used within TeamPage');
  return ctx;
}

// ── Types ──────────────────────────────────────────────────────────────────

type ArtefactView =
  | { kind: 'files'; path: string[]; entries: FileEntry[]; cursor: number }
  | { kind: 'file-content'; relPath: string[]; content: string }
  | { kind: 'diff'; diffText: string };

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

// ── Route-ID constants for useMatches ─────────────────────────────────────

const PROJECT_ROUTE_ID = '/teams/$teamId/projects/$projectName';
const AGENT_IN_PROJECT_ROUTE_ID =
  '/teams/$teamId/projects/$projectName/agents/$agentName';
const AGENT_ROUTE_ID = '/teams/$teamId/agents/$agentName';

// ── Main component ─────────────────────────────────────────────────────────

function TeamPage() {
  const initialData = Route.useLoaderData();
  const { teamId } = Route.useParams();

  // ── Derive route context from current URL ─────────────────────────────────
  const matches = useMatches();

  const projectMatch = matches.find((m) => m.routeId === PROJECT_ROUTE_ID);
  const agentInProjectMatch = matches.find(
    (m) => m.routeId === AGENT_IN_PROJECT_ROUTE_ID,
  );
  const agentOnlyMatch = matches.find((m) => m.routeId === AGENT_ROUTE_ID);

  const currentProjectName =
    (projectMatch?.params as { projectName?: string } | undefined)
      ?.projectName ??
    (agentInProjectMatch?.params as { projectName?: string } | undefined)
      ?.projectName;

  const currentAgentName =
    (agentInProjectMatch?.params as { agentName?: string } | undefined)
      ?.agentName ??
    (agentOnlyMatch?.params as { agentName?: string } | undefined)?.agentName;

  const routeCtx = useMemo(
    () => ({ currentProjectName, currentAgentName }),
    [currentProjectName, currentAgentName],
  );

  const {
    messages,
    agents,
    projects,
    input,
    setInput,
    sending,
    mode,
    setMode,
    overlay,
    setOverlay,
    focusedIdx,
    setFocusedIdx,
    projectMessages,
    projectSending,
    sessionData,
    setSessionData,
    modeRef,
    routeCtxRef,
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
    currentProjectId,
  } = useTeamPage({ ...initialData, teamId }, routeCtx);

  // ── Artefact state ─────────────────────────────────────────────────────────
  const [artefactView, setArtefactView] = useState<ArtefactView | null>(null);
  const [diffStats, setDiffStats] = useState<DiffStats | null>(null);

  // ── DOM-only refs (tightly coupled to JSX) ─────────────────────────────────
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasInitialScrolled = useRef(false);

  // projectsRef lets the keyboard handler read latest projects without being in deps
  const projectsRef = useRef(projects);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);
  // useLayoutEffect so the ref is current before the browser paints — avoids
  // a race where the user presses a key before the effect runs post-paint.
  const artefactViewRef = useRef(artefactView);
  useLayoutEffect(() => {
    artefactViewRef.current = artefactView;
  }, [artefactView]);

  // ── Artefact server functions ──────────────────────────────────────────────
  const getTeamFilesFn = useServerFn(getTeamFiles);
  const getTeamFileContentFn = useServerFn(getTeamFileContent);
  const getProjectDiffFn = useServerFn(getProjectDiffServerFn);
  // Stable refs so keyboard handler doesn't need these in its deps array
  const getTeamFilesFnRef = useRef(getTeamFilesFn);
  const getTeamFileContentFnRef = useRef(getTeamFileContentFn);
  const getProjectDiffFnRef = useRef(getProjectDiffFn);
  useEffect(() => {
    getTeamFilesFnRef.current = getTeamFilesFn;
    getTeamFileContentFnRef.current = getTeamFileContentFn;
    getProjectDiffFnRef.current = getProjectDiffFn;
  });

  // Load diff stats whenever we enter a project-chat view
  useEffect(() => {
    if (!currentProjectId) {
      setDiffStats(null);
      return;
    }
    const project = projects.find((p) => p.id === currentProjectId);
    if (!project) return;
    getProjectDiffFn({
      data: { branch: project.branch },
    }).then((result) => {
      setDiffStats(result.stats);
    });
  }, [currentProjectId, projects, getProjectDiffFn]);

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
  useEffect(() => {
    if (!currentAgentName) return;
    if (sessionData) {
      setTimeout(
        () => bottomRef.current?.scrollIntoView({ behavior: 'instant' }),
        50,
      );
    }
  }, [sessionData, currentAgentName]);

  // Scroll to bottom after project messages load
  // biome-ignore lint/correctness/useExhaustiveDependencies: projectMessages triggers scroll on enter
  useEffect(() => {
    if (!currentProjectId) return;
    if (projectMessages.length > 0) {
      setTimeout(
        () => bottomRef.current?.scrollIntoView({ behavior: 'instant' }),
        50,
      );
    }
  }, [currentProjectId]);

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

  // ── Artefact actions ───────────────────────────────────────────────────────

  async function openFilesBrowser(path: string[] = []) {
    const entries = await getTeamFilesFnRef.current({
      data: { teamId, subPath: path },
    });
    setArtefactView({ kind: 'files', path, entries, cursor: 0 });
  }

  async function openDiffViewer() {
    const ctx = routeCtxRef.current;
    if (!ctx.currentProjectName || ctx.currentAgentName) return;
    const project = projectsRef.current.find(
      (p) => p.name === ctx.currentProjectName,
    );
    if (!project) return;
    const result = await getProjectDiffFnRef.current({
      data: { branch: project.branch },
    });
    setDiffStats(result.stats);
    setArtefactView({ kind: 'diff', diffText: result.diff });
  }

  // ── Global keyboard handler ───────────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: handler intentionally reads latest state via refs; only navigate/teamId trigger re-registration
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const currentMode = modeRef.current;
      const currentCtx = routeCtxRef.current;
      const currentOverlay = overlayRef.current;
      const currentFocused = focusedIdxRef.current;
      const blocks = navBlocksRef.current;
      const currentArtefact = artefactViewRef.current;

      // Artefact view keyboard handling (takes priority)
      if (currentArtefact !== null) {
        if (e.key === 'Escape') {
          setArtefactView(null);
          e.preventDefault();
          return;
        }
        if (e.key === '-') {
          if (currentArtefact.kind === 'files') {
            if (currentArtefact.path.length > 0) {
              openFilesBrowser(currentArtefact.path.slice(0, -1));
            } else {
              setArtefactView(null);
            }
          } else if (currentArtefact.kind === 'file-content') {
            openFilesBrowser(currentArtefact.relPath.slice(0, -1));
          } else {
            setArtefactView(null);
          }
          e.preventDefault();
          return;
        }
        if (currentArtefact.kind === 'files') {
          if (e.key === 'j') {
            setArtefactView((av) =>
              av?.kind === 'files'
                ? {
                    ...av,
                    cursor: Math.min(av.cursor + 1, av.entries.length - 1),
                  }
                : av,
            );
            e.preventDefault();
            return;
          }
          if (e.key === 'k') {
            setArtefactView((av) =>
              av?.kind === 'files'
                ? { ...av, cursor: Math.max(av.cursor - 1, 0) }
                : av,
            );
            e.preventDefault();
            return;
          }
          if (e.key === 'Enter') {
            const entry = currentArtefact.entries[currentArtefact.cursor];
            if (entry) {
              const newPath = [...currentArtefact.path, entry.name];
              if (entry.type === 'dir') {
                openFilesBrowser(newPath);
              } else {
                getTeamFileContentFnRef
                  .current({ data: { teamId, relPath: newPath } })
                  .then((content) => {
                    setArtefactView({
                      kind: 'file-content',
                      relPath: newPath,
                      content,
                    });
                  });
              }
            }
            e.preventDefault();
            return;
          }
        }
        // Unhandled key in artefact view — fall through to normal mode so
        // pickers (p, a, t, f) and other shortcuts still work.
      }

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

        case 'f':
          openFilesBrowser([]);
          e.preventDefault();
          break;

        case 'd':
          if (currentCtx.currentProjectName && !currentCtx.currentAgentName) {
            openDiffViewer();
          }
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
  }, [navigate, teamId]);

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
          navigate({
            to: '/teams/$teamId/projects/$projectName',
            params: { teamId, projectName: p.name },
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
          const ctx = routeCtxRef.current;
          if (ctx.currentProjectName) {
            navigate({
              to: '/teams/$teamId/projects/$projectName/agents/$agentName',
              params: {
                teamId,
                projectName: ctx.currentProjectName,
                agentName: ag.name,
              },
            });
          } else {
            navigate({
              to: '/teams/$teamId/agents/$agentName',
              params: { teamId, agentName: ag.name },
            });
          }
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

  const inputDisabled = isSending || !!currentAgentName;

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: setFocusedIdx and bottomRef are stable refs
  const contextValue: TeamPageContextType = useMemo(
    () => ({ navBlocks, focusedIdx, setFocusedIdx, bottomRef }),
    [navBlocks, focusedIdx],
  );

  return (
    <TeamPageContext.Provider value={contextValue}>
      <div className="flex flex-col h-screen bg-background overflow-hidden font-mono">
        {/* ── Content area ────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col">
          {artefactView !== null ? (
            artefactView.kind === 'files' ? (
              <FilesView
                teamId={teamId}
                path={artefactView.path}
                entries={artefactView.entries}
                cursor={artefactView.cursor}
                onSelectEntry={(entry, newPath) => {
                  if (entry.type === 'dir') {
                    openFilesBrowser(newPath);
                  } else {
                    getTeamFileContentFn({
                      data: { teamId, relPath: newPath },
                    }).then((content) => {
                      setArtefactView({
                        kind: 'file-content',
                        relPath: newPath,
                        content,
                      });
                    });
                  }
                }}
                onNavigateCursor={(cursor) =>
                  setArtefactView((av) =>
                    av?.kind === 'files' ? { ...av, cursor } : av,
                  )
                }
              />
            ) : artefactView.kind === 'file-content' ? (
              <FileContentView
                relPath={artefactView.relPath}
                content={artefactView.content}
              />
            ) : (
              <DiffView
                diffText={artefactView.diffText}
                stats={
                  diffStats ?? { filesChanged: 0, insertions: 0, deletions: 0 }
                }
              />
            )
          ) : (
            <Outlet />
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
                <Breadcrumb
                  teamId={teamId}
                  projectName={currentProjectName}
                  agentName={currentAgentName}
                />
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
                  navigate({
                    to: '/teams/$teamId/projects/$projectName',
                    params: { teamId, projectName: p.name },
                  });
                  setFocusedIdx(-1);
                  closePicker();
                }}
                onSelectAgent={(ag) => {
                  const ctx = routeCtxRef.current;
                  if (ctx.currentProjectName) {
                    navigate({
                      to: '/teams/$teamId/projects/$projectName/agents/$agentName',
                      params: {
                        teamId,
                        projectName: ctx.currentProjectName,
                        agentName: ag.name,
                      },
                    });
                  } else {
                    navigate({
                      to: '/teams/$teamId/agents/$agentName',
                      params: { teamId, agentName: ag.name },
                    });
                  }
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
          <button
            type="button"
            onClick={() => openFilesBrowser([])}
            className="text-muted-foreground/50 hover:text-primary hover:underline ml-3"
          >
            files
          </button>
          <span className="text-muted-foreground/30 ml-0.5">(f)</span>
          {currentProjectId && !currentAgentName && diffStats !== null && (
            <>
              <button
                type="button"
                onClick={() => openDiffViewer()}
                className="text-muted-foreground/50 hover:text-primary hover:underline ml-3"
              >
                {diffStats.filesChanged} files changed +{diffStats.insertions} -
                {diffStats.deletions}
              </button>
              <span className="text-muted-foreground/30 ml-0.5">(d)</span>
            </>
          )}
          {mode === 'normal' && (
            <span className="ml-auto text-muted-foreground/50">NORMAL</span>
          )}
        </div>
      </div>
    </TeamPageContext.Provider>
  );
}
