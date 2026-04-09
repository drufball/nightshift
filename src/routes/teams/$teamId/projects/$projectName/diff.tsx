import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useEffect, useRef, useState } from 'react';
import type { DiffStats } from '~/server/artefacts';
import { getProjectDiffFn as getProjectDiffServerFn } from '~/server/artefacts';
import { DiffView } from '../../-diff-view';
import { useTeamPageContext } from '../../../$teamId';

export const Route = createFileRoute(
  '/teams/$teamId/projects/$projectName/diff',
)({
  component: ProjectDiffPage,
});

function ProjectDiffPage() {
  const { teamId, projectName } = Route.useParams();
  const navigate = useNavigate();
  const { projects } = useTeamPageContext();

  const getProjectDiffFn = useServerFn(getProjectDiffServerFn);
  const getProjectDiffFnRef = useRef(getProjectDiffFn);
  useEffect(() => {
    getProjectDiffFnRef.current = getProjectDiffFn;
  });

  const [diffText, setDiffText] = useState('');
  const [stats, setStats] = useState<DiffStats>({
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
  });

  const project = projects.find((p) => p.name === projectName);

  // biome-ignore lint/correctness/useExhaustiveDependencies: getProjectDiffFnRef is a stable ref
  useEffect(() => {
    if (!project) return;
    getProjectDiffFnRef
      .current({ data: { branch: project.branch } })
      .then((result) => {
        setDiffText(result.diff);
        setStats(result.stats);
      });
  }, [project?.branch]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === '-') {
        navigate({
          to: '/teams/$teamId/projects/$projectName',
          params: { teamId, projectName },
        });
        e.preventDefault();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, teamId, projectName]);

  return <DiffView diffText={diffText} stats={stats} />;
}
