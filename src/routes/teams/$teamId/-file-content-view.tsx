import type React from 'react';
import Markdown from 'react-markdown';

function FlatHeading({ children }: { children?: React.ReactNode }) {
  return <p className="font-bold">{children}</p>;
}
const markdownComponents = {
  h1: FlatHeading,
  h2: FlatHeading,
  h3: FlatHeading,
  h4: FlatHeading,
  h5: FlatHeading,
  h6: FlatHeading,
};

export function FileContentView({
  relPath,
  content,
}: {
  relPath: string[];
  content: string;
}) {
  const fileName = relPath[relPath.length - 1] ?? '';
  const isMarkdown = fileName.endsWith('.md') || fileName.endsWith('.mdx');
  return (
    <div className="px-4 py-4 flex flex-col gap-2 overflow-y-auto">
      <div className="text-xs text-muted-foreground/50 mb-2 select-none">
        {relPath.join('/')}
        <span className="ml-2 text-muted-foreground/30">
          - go back · esc close
        </span>
      </div>
      {isMarkdown ? (
        <div className="prose prose-sm dark:prose-invert max-w-none text-sm text-foreground">
          <Markdown components={markdownComponents}>{content}</Markdown>
        </div>
      ) : (
        <pre className="text-sm text-foreground whitespace-pre-wrap break-words font-mono">
          {content}
        </pre>
      )}
    </div>
  );
}
