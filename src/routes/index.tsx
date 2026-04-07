import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { CommandPicker } from '~/components/command-picker';
import { Separator } from '~/components/ui/separator';
import type { TeamMeta } from '~/server/teams';
import { createTeam, getHomeTeam, listTeams } from '~/server/teams';

export const Route = createFileRoute('/')({
  loader: async () => {
    const homeTeam = await getHomeTeam();
    if (homeTeam) {
      throw redirect({ to: '/teams/$teamId', params: { teamId: homeTeam } });
    }
    return listTeams();
  },
  component: TeamsPage,
});

function TeamsPage() {
  const [teams, setTeams] = useState<TeamMeta[]>(Route.useLoaderData());
  const navigate = useNavigate();
  const createTeamFn = useServerFn(createTeam);

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden font-mono">
      {/* Empty content area pushes picker to the bottom */}
      <div className="flex-1" />

      {/* Picker floats above the footer separator */}
      <div className="relative shrink-0">
        <div className="absolute bottom-full inset-x-0 z-50 bg-background border border-border/50 shadow-lg">
          {teams.length === 0 ? (
            <div className="px-4 py-2 text-sm text-muted-foreground">
              No teams yet — run{' '}
              <code className="text-foreground">nightshift team create</code>
            </div>
          ) : (
            <CommandPicker
              items={teams.map((t) => ({
                name: `${t.name}/`,
                meta: `${t.lead} +${t.members.length}`,
              }))}
              onSelect={(i) => {
                const team = teams[i];
                if (team) {
                  navigate({
                    to: '/teams/$teamId',
                    params: { teamId: team.name },
                  });
                }
              }}
              createLabel="new team"
              onCreate={async (name) => {
                const team = await createTeamFn({ data: { name } });
                setTeams((prev) => [...prev, team]);
              }}
            />
          )}
        </div>
        <Separator />
        <div className="px-4 py-1 flex items-center gap-1.5 text-xs text-muted-foreground/50">
          <span className="text-primary">~/</span>
          <span>nightshift</span>
        </div>
      </div>
    </div>
  );
}
