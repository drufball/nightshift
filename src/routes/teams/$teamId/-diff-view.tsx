import type { DiffStats } from '~/server/artefacts';

export function DiffView({
  diffText,
  stats,
}: {
  diffText: string;
  stats: DiffStats;
}) {
  return (
    <div className="px-4 py-4 flex flex-col gap-2 overflow-y-auto">
      <div className="text-xs text-muted-foreground/50 mb-2 select-none">
        {stats.filesChanged} files changed{' '}
        <span className="text-green-600 dark:text-green-400">
          +{stats.insertions}
        </span>{' '}
        <span className="text-red-600 dark:text-red-400">
          -{stats.deletions}
        </span>
        <span className="ml-2 text-muted-foreground/30">esc close</span>
      </div>
      {!diffText ? (
        <p className="text-sm text-muted-foreground/50 italic">
          No changes on this branch.
        </p>
      ) : (
        <pre className="text-xs font-mono whitespace-pre-wrap break-words">
          {diffText.split('\n').map((line, i) => {
            const cls =
              line.startsWith('+++') || line.startsWith('---')
                ? 'text-muted-foreground'
                : line.startsWith('+')
                  ? 'text-green-600 dark:text-green-400'
                  : line.startsWith('-')
                    ? 'text-red-600 dark:text-red-400'
                    : line.startsWith('@@')
                      ? 'text-blue-500 dark:text-blue-400'
                      : line.startsWith('diff ')
                        ? 'text-primary font-bold'
                        : 'text-foreground';
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no stable id
              <span key={i} className={`${cls} block`}>
                {line || ' '}
              </span>
            );
          })}
        </pre>
      )}
    </div>
  );
}
