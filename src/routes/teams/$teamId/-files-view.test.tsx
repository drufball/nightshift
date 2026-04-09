import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FileEntry } from '~/server/artefacts';
import { FilesView } from './-files-view';

afterEach(cleanup);

function makeEntry(name: string, type: 'file' | 'dir' = 'file'): FileEntry {
  return { name, type };
}

function renderView(
  overrides: Partial<{
    teamId: string;
    path: string[];
    entries: FileEntry[];
    cursor: number;
    onSelectEntry: (entry: FileEntry, newPath: string[]) => void;
    onNavigateCursor: (cursor: number) => void;
  }> = {},
) {
  return render(
    <FilesView
      teamId={overrides.teamId ?? 'my-team'}
      path={overrides.path ?? []}
      entries={overrides.entries ?? []}
      cursor={overrides.cursor ?? 0}
      onSelectEntry={overrides.onSelectEntry ?? (() => {})}
      onNavigateCursor={overrides.onNavigateCursor ?? (() => {})}
    />,
  );
}

describe('FilesView', () => {
  it('shows ../ when path is non-empty', () => {
    renderView({ path: ['subdir'] });
    screen.getByText('../');
  });

  it('does not show ../ at the root path', () => {
    renderView({ path: [] });
    expect(screen.queryByText('../')).toBeNull();
  });

  it('shows (empty) when entries list is empty', () => {
    renderView({ entries: [] });
    screen.getByText('(empty)');
  });

  it('does not show (empty) when entries are present', () => {
    renderView({ entries: [makeEntry('file.md')] });
    expect(screen.queryByText('(empty)')).toBeNull();
  });

  it('renders entry names', () => {
    renderView({ entries: [makeEntry('notes.md')] });
    screen.getByText('notes.md');
  });

  it('appends / to directory entries', () => {
    renderView({ entries: [makeEntry('docs', 'dir')] });
    screen.getByText('docs/');
  });

  it('does not append / to file entries', () => {
    renderView({ entries: [makeEntry('readme.md')] });
    screen.getByText('readme.md');
    expect(screen.queryByText('readme.md/')).toBeNull();
  });

  it('applies text-primary to directory entry name spans', () => {
    renderView({ entries: [makeEntry('docs', 'dir')] });
    const span = screen.getByText('docs/');
    expect(span.className).toContain('text-primary');
  });

  it('applies text-foreground to file entry name spans', () => {
    renderView({ entries: [makeEntry('readme.md')] });
    const span = screen.getByText('readme.md');
    expect(span.className).toContain('text-foreground');
  });

  it('applies cursor highlight to entry at cursor index', () => {
    renderView({
      entries: [makeEntry('a.md'), makeEntry('b.md')],
      cursor: 1,
    });
    const buttons = screen.getAllByRole('button');
    expect(buttons[1].className).toContain('bg-primary/10');
    expect(buttons[0].className).not.toContain('bg-primary/10');
  });

  it('calls onSelectEntry with the entry and new path when clicked', async () => {
    const user = userEvent.setup();
    const onSelectEntry = mock(() => {});
    const entry = makeEntry('notes.md');
    renderView({
      path: ['docs'],
      entries: [entry],
      onSelectEntry,
    });
    await user.click(screen.getByRole('button'));
    expect(onSelectEntry).toHaveBeenCalledWith(entry, ['docs', 'notes.md']);
  });

  it('calls onNavigateCursor with the entry index on mouse enter', async () => {
    const user = userEvent.setup();
    const onNavigateCursor = mock(() => {});
    renderView({
      entries: [makeEntry('a.md'), makeEntry('b.md')],
      onNavigateCursor,
    });
    const buttons = screen.getAllByRole('button');
    await user.hover(buttons[1]);
    expect(onNavigateCursor).toHaveBeenCalledWith(1);
  });

  it('includes teamId and path in the header title', () => {
    renderView({ teamId: 'alpha', path: ['docs', 'api'] });
    screen.getByText(/alpha\/docs\/api/);
  });
});
