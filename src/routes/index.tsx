import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import type React from 'react';
import { useState } from 'react';
import { Separator } from '~/components/ui/separator';
import {
  createTeam,
  getHomeTeam,
  listTeams,
  resolveStartTeam,
} from '~/server/teams';

export const Route = createFileRoute('/')({
  loader: async () => {
    const [homeTeam, teams] = await Promise.all([getHomeTeam(), listTeams()]);
    const startTeam = resolveStartTeam(homeTeam, teams);
    if (startTeam) {
      throw redirect({ to: '/teams/$teamId', params: { teamId: startTeam } });
    }
    // No teams exist — show create flow
    return null;
  },
  component: CreateTeamPage,
});

function CreateTeamPage() {
  const navigate = useNavigate();
  const createTeamFn = useServerFn(createTeam);
  const [name, setName] = useState('');

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const team = await createTeamFn({ data: { name: trimmed } });
    navigate({ to: '/teams/$teamId', params: { teamId: team.name } });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      handleCreate();
      e.preventDefault();
    }
  }

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden font-mono">
      <div className="flex-1" />
      <div className="relative shrink-0">
        <div className="absolute bottom-full inset-x-0 z-50 bg-background border border-border/50 shadow-lg">
          <div className="px-4 py-1.5 flex items-center gap-1.5">
            <span className="text-muted-foreground text-xs select-none shrink-0">
              name:
            </span>
            <input
              // biome-ignore lint/a11y/noAutofocus: intentional — only element on page
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="new team name..."
              className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground/40 font-mono"
            />
          </div>
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
