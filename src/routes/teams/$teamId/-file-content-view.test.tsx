import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { FileContentView } from './-file-content-view';

afterEach(cleanup);

describe('FileContentView', () => {
  it('displays the file path with segments joined by /', () => {
    render(
      <FileContentView
        relPath={['src', 'lib', 'utils.ts']}
        content="export {}"
      />,
    );
    screen.getByText(/src\/lib\/utils\.ts/);
  });

  it('renders non-markdown files as raw text in a pre element', () => {
    const { container } = render(
      <FileContentView relPath={['script.sh']} content="echo hello" />,
    );
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('echo hello');
  });

  it('does not use a pre element for .md files', () => {
    const { container } = render(
      <FileContentView relPath={['readme.md']} content="# Hello" />,
    );
    expect(container.querySelector('pre')).toBeNull();
  });

  it('renders .md files via Markdown — headings become bold paragraphs', () => {
    // The custom FlatHeading renders h1–h6 as <p className="font-bold">
    render(<FileContentView relPath={['readme.md']} content="# Hello world" />);
    const heading = screen.getByText('Hello world');
    expect(heading.tagName).toBe('P');
    expect(heading.className).toContain('font-bold');
  });

  it('renders .mdx files via Markdown', () => {
    render(<FileContentView relPath={['doc.mdx']} content="# Title" />);
    const heading = screen.getByText('Title');
    expect(heading.tagName).toBe('P');
    expect(heading.className).toContain('font-bold');
  });

  it('treats non-markdown extensions as plain text even with markdown syntax', () => {
    const { container } = render(
      <FileContentView relPath={['notes.txt']} content="# Not a heading" />,
    );
    const pre = container.querySelector('pre');
    expect(pre?.textContent).toContain('# Not a heading');
  });

  it('uses the last path segment for extension detection', () => {
    // Path ends in .ts (not markdown), so renders as pre
    const { container } = render(
      <FileContentView relPath={['docs', 'readme.ts']} content="# code" />,
    );
    expect(container.querySelector('pre')).not.toBeNull();
  });
});
