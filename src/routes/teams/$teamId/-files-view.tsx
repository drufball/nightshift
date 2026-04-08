import { cn } from '~/lib/utils';
import type { FileEntry } from '~/server/artefacts';

export function FilesView({
  teamId,
  path,
  entries,
  cursor,
  onSelectEntry,
  onNavigateCursor,
}: {
  teamId: string;
  path: string[];
  entries: FileEntry[];
  cursor: number;
  onSelectEntry: (entry: FileEntry, newPath: string[]) => void;
  onNavigateCursor: (cursor: number) => void;
}) {
  const title = [teamId, ...path].join('/');
  return (
    <div className="px-4 py-4 flex flex-col gap-1 mt-auto">
      <div className="text-xs text-muted-foreground/50 mb-2 select-none">
        .nightshift/teams/{title}
        <span className="ml-2 text-muted-foreground/30">
          j/k navigate · enter open · - up · esc close
        </span>
      </div>
      {path.length > 0 && (
        <div className="text-sm text-muted-foreground/50 py-0.5 pl-2 select-none">
          ../
        </div>
      )}
      {entries.length === 0 && (
        <p className="text-sm text-muted-foreground/50 italic">(empty)</p>
      )}
      {entries.map((entry, i) => (
        <button
          key={entry.name}
          type="button"
          onClick={() => onSelectEntry(entry, [...path, entry.name])}
          onMouseEnter={() => onNavigateCursor(i)}
          className={cn(
            'text-left w-full py-0.5 pl-2 -ml-2 rounded-sm transition-colors text-sm',
            i === cursor ? 'bg-primary/10' : 'hover:bg-accent/20',
          )}
        >
          <span
            className={cn(
              entry.type === 'dir' ? 'text-primary' : 'text-foreground',
            )}
          >
            {entry.name}
            {entry.type === 'dir' ? '/' : ''}
          </span>
        </button>
      ))}
    </div>
  );
}
