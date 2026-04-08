import type { Project } from '~/db/projects';
import { cn } from '~/lib/utils';
import type { TeamMeta } from '~/server/teams';
import type { AgentInfo, OverlayState } from './use-team-page';

export function InlinePicker({
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
