import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FileEntry } from '~/server/artefacts';
import { getTeamFileContent, getTeamFiles } from '~/server/artefacts';
import { FileContentView } from '../../-file-content-view';
import { FilesView } from '../../-files-view';

export const Route = createFileRoute(
  '/teams/$teamId/projects/$projectName/files',
)({
  component: ProjectFilesPage,
});

type FilesViewState =
  | { kind: 'files'; path: string[]; entries: FileEntry[]; cursor: number }
  | { kind: 'file-content'; relPath: string[]; content: string };

function ProjectFilesPage() {
  const { teamId, projectName } = Route.useParams();
  const navigate = useNavigate();

  const getTeamFilesFn = useServerFn(getTeamFiles);
  const getTeamFileContentFn = useServerFn(getTeamFileContent);
  const getTeamFilesFnRef = useRef(getTeamFilesFn);
  const getTeamFileContentFnRef = useRef(getTeamFileContentFn);
  useEffect(() => {
    getTeamFilesFnRef.current = getTeamFilesFn;
    getTeamFileContentFnRef.current = getTeamFileContentFn;
  });

  const [view, setView] = useState<FilesViewState | null>(null);
  const viewRef = useRef(view);
  useLayoutEffect(() => {
    viewRef.current = view;
  }, [view]);

  async function openPath(path: string[]) {
    const entries = await getTeamFilesFnRef.current({
      data: { teamId, subPath: path },
    });
    setView({ kind: 'files', path, entries, cursor: 0 });
  }

  const openPathRef = useRef(openPath);
  useEffect(() => {
    openPathRef.current = openPath;
  });

  // Load root on mount
  useEffect(() => {
    openPathRef.current([]);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const current = viewRef.current;

      if (e.key === 'Escape') {
        navigate({
          to: '/teams/$teamId/projects/$projectName',
          params: { teamId, projectName },
        });
        e.preventDefault();
        return;
      }

      if (e.key === '-') {
        if (current?.kind === 'files') {
          if (current.path.length > 0) {
            openPathRef.current(current.path.slice(0, -1));
          } else {
            navigate({
              to: '/teams/$teamId/projects/$projectName',
              params: { teamId, projectName },
            });
          }
        } else if (current?.kind === 'file-content') {
          openPathRef.current(current.relPath.slice(0, -1));
        }
        e.preventDefault();
        return;
      }

      if (current?.kind === 'files') {
        if (e.key === 'j') {
          setView((v) =>
            v?.kind === 'files'
              ? { ...v, cursor: Math.min(v.cursor + 1, v.entries.length - 1) }
              : v,
          );
          e.preventDefault();
        } else if (e.key === 'k') {
          setView((v) =>
            v?.kind === 'files'
              ? { ...v, cursor: Math.max(v.cursor - 1, 0) }
              : v,
          );
          e.preventDefault();
        } else if (e.key === 'Enter') {
          const entry = current.entries[current.cursor];
          if (entry) {
            const newPath = [...current.path, entry.name];
            if (entry.type === 'dir') {
              openPathRef.current(newPath);
            } else {
              getTeamFileContentFnRef
                .current({ data: { teamId, relPath: newPath } })
                .then((content) => {
                  setView({ kind: 'file-content', relPath: newPath, content });
                });
            }
          }
          e.preventDefault();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, teamId, projectName]);

  if (!view) return null;

  if (view.kind === 'file-content') {
    return <FileContentView relPath={view.relPath} content={view.content} />;
  }

  return (
    <FilesView
      teamId={teamId}
      path={view.path}
      entries={view.entries}
      cursor={view.cursor}
      onSelectEntry={(entry, newPath) => {
        if (entry.type === 'dir') {
          openPath(newPath);
        } else {
          getTeamFileContentFn({ data: { teamId, relPath: newPath } }).then(
            (content) => {
              setView({ kind: 'file-content', relPath: newPath, content });
            },
          );
        }
      }}
      onNavigateCursor={(cursor) =>
        setView((v) => (v?.kind === 'files' ? { ...v, cursor } : v))
      }
    />
  );
}
