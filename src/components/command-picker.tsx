import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '~/lib/utils';

export type PickerItem = {
  name: string;
  meta?: string;
  highlight?: boolean;
};

export function CommandPicker({
  items,
  onSelect,
  onClose,
  createLabel,
  onCreate,
}: {
  items: PickerItem[];
  onSelect: (originalIdx: number) => void;
  onClose?: () => void;
  createLabel?: string;
  onCreate?: (name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(
    () =>
      items.filter((item) =>
        item.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [items, query],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset cursor when query changes OR when filtered set shrinks (cursor can go out-of-bounds without a query change, e.g. items prop updates)
  useEffect(() => {
    setCursor(0);
  }, [query, filtered.length]);

  useEffect(() => {
    if (creating) {
      createInputRef.current?.focus();
    } else {
      inputRef.current?.focus();
    }
  }, [creating]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function stopCreating() {
    setCreating(false);
    setNewName('');
  }

  function handleCreateKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && newName.trim()) {
      onCreate?.(newName.trim());
      stopCreating();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      stopCreating();
      e.preventDefault();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'Escape':
        onClose?.();
        e.preventDefault();
        break;
      case 'ArrowDown':
        setCursor((c) => Math.min(c + 1, Math.max(filtered.length - 1, 0)));
        e.preventDefault();
        break;
      case 'ArrowUp':
        setCursor((c) => Math.max(c - 1, 0));
        e.preventDefault();
        break;
      case 'Enter': {
        const item = filtered[cursor];
        if (item) {
          onSelect(items.indexOf(item));
        }
        e.preventDefault();
        break;
      }
    }
  }

  return (
    <div className="bg-background">
      <div className="px-4 py-1.5 border-b border-border/30 flex items-center gap-1.5">
        {creating ? (
          <>
            <span className="text-muted-foreground text-xs select-none shrink-0">
              name:
            </span>
            <input
              ref={createInputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleCreateKeyDown}
              placeholder={createLabel ?? 'new name...'}
              className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground/40 font-mono"
            />
          </>
        ) : (
          <>
            <span className="text-primary text-sm select-none">❯</span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="filter..."
              className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground/40 font-mono"
            />
          </>
        )}
      </div>
      <div className="max-h-60 overflow-y-auto">
        {!creating && filtered.length === 0 && (
          <div className="px-4 py-1.5 text-sm text-muted-foreground/50 italic font-mono">
            (no matches)
          </div>
        )}
        {!creating &&
          filtered.map((item, i) => (
            <button
              key={item.name}
              type="button"
              onClick={() => onSelect(items.indexOf(item))}
              onMouseEnter={() => setCursor(i)}
              className={cn(
                'flex items-baseline justify-between text-left w-full px-4 py-1 text-sm font-mono transition-colors',
                i === cursor
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/40',
              )}
            >
              <span
                className={cn(
                  item.highlight ? 'text-secondary' : 'text-foreground',
                )}
              >
                {item.name}
              </span>
              {item.meta && (
                <span
                  className={cn(
                    'text-xs ml-4 truncate',
                    item.highlight
                      ? 'text-secondary/70'
                      : 'text-muted-foreground/60',
                  )}
                >
                  {item.meta}
                </span>
              )}
            </button>
          ))}
        {!creating && onCreate && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1 text-left w-full px-4 py-1 text-sm font-mono text-muted-foreground/50 hover:text-primary hover:bg-accent/40 transition-colors border-t border-border/20"
          >
            + {createLabel ?? 'new'}
          </button>
        )}
      </div>
    </div>
  );
}
