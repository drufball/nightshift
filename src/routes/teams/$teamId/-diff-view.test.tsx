import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { DiffView } from './-diff-view';

afterEach(cleanup);

const noStats = { filesChanged: 0, insertions: 0, deletions: 0 };

describe('DiffView', () => {
  it('shows "No changes on this branch" when diffText is empty', () => {
    render(<DiffView diffText="" stats={noStats} />);
    screen.getByText(/No changes on this branch/);
  });

  it('does not show "No changes" when diffText is non-empty', () => {
    render(<DiffView diffText="+added line" stats={noStats} />);
    expect(screen.queryByText(/No changes on this branch/)).toBeNull();
  });

  it('renders filesChanged count in stats header', () => {
    render(
      <DiffView
        diffText="x"
        stats={{ filesChanged: 3, insertions: 0, deletions: 0 }}
      />,
    );
    screen.getByText(/3 files changed/);
  });

  it('renders insertions count in a green span', () => {
    render(
      <DiffView
        diffText="x"
        stats={{ filesChanged: 1, insertions: 10, deletions: 0 }}
      />,
    );
    const span = screen.getByText('+10');
    expect(span.className).toContain('text-green');
  });

  it('renders deletions count in a red span', () => {
    render(
      <DiffView
        diffText="x"
        stats={{ filesChanged: 1, insertions: 0, deletions: 5 }}
      />,
    );
    const span = screen.getByText('-5');
    expect(span.className).toContain('text-red');
  });

  it('applies muted class (not green) to +++ header lines', () => {
    render(<DiffView diffText="+++ b/file.ts" stats={noStats} />);
    const span = screen.getByText('+++ b/file.ts');
    expect(span.className).toContain('text-muted-foreground');
    expect(span.className).not.toContain('text-green');
  });

  it('applies muted class (not red) to --- header lines', () => {
    render(<DiffView diffText="--- a/file.ts" stats={noStats} />);
    const span = screen.getByText('--- a/file.ts');
    expect(span.className).toContain('text-muted-foreground');
    expect(span.className).not.toContain('text-red');
  });

  it('applies green class to + addition lines', () => {
    render(<DiffView diffText="+added line" stats={noStats} />);
    const span = screen.getByText('+added line');
    expect(span.className).toContain('text-green');
  });

  it('applies red class to - deletion lines', () => {
    render(<DiffView diffText="-removed line" stats={noStats} />);
    const span = screen.getByText('-removed line');
    expect(span.className).toContain('text-red');
  });

  it('applies blue class to @@ hunk header lines', () => {
    render(<DiffView diffText="@@ -1,3 +1,4 @@" stats={noStats} />);
    const span = screen.getByText('@@ -1,3 +1,4 @@');
    expect(span.className).toContain('text-blue');
  });

  it('applies primary font-bold class to diff --git header lines', () => {
    render(<DiffView diffText="diff --git a/x.ts b/x.ts" stats={noStats} />);
    const span = screen.getByText('diff --git a/x.ts b/x.ts');
    expect(span.className).toContain('text-primary');
    expect(span.className).toContain('font-bold');
  });

  it('applies foreground class to context lines', () => {
    // Context lines in unified diffs start with a space; use regex to avoid
    // getByText's default whitespace normalization stripping the leading space.
    render(<DiffView diffText=" context line" stats={noStats} />);
    const span = screen.getByText(/context line/);
    expect(span.className).toContain('text-foreground');
  });
});
