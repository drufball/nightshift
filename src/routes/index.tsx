import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Separator } from '~/components/ui/separator';
import { listTeams } from '~/server/teams';

export const Route = createFileRoute('/')({
  loader: () => listTeams(),
  component: TeamsPage,
});

function TeamsPage() {
  const teams = Route.useLoaderData();
  const navigate = useNavigate();

  return (
    <div className="flex h-screen items-start justify-center pt-32">
      <div className="w-full max-w-sm">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xs font-mono text-muted-foreground">
            nightshift
          </span>
          <span className="text-xs font-mono text-muted-foreground">teams</span>
        </div>
        <Separator className="mb-1" />
        {teams.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground font-mono">
            No teams yet — run{' '}
            <code className="text-foreground">nightshift team create</code>
          </p>
        ) : (
          <ul>
            {teams.map((team) => (
              <li key={team.name}>
                <button
                  type="button"
                  className="w-full text-left px-2 py-1 text-sm font-mono hover:bg-accent hover:text-accent-foreground rounded-sm flex items-center justify-between group"
                  onClick={() =>
                    navigate({
                      to: '/teams/$teamId',
                      params: { teamId: team.name },
                    })
                  }
                >
                  <span>{team.name}/</span>
                  <span className="text-xs text-muted-foreground group-hover:text-accent-foreground truncate ml-4">
                    {team.lead} +{team.members.length}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Separator className="mt-1" />
      </div>
    </div>
  );
}
