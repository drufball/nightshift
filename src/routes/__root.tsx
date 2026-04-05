import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import appCss from '~/app.css?url';
import { Button } from '~/components/ui/button';
import { TooltipProvider } from '~/components/ui/tooltip';

export const Route = createRootRoute({
  head: () => ({
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
});

function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setDark((d) => !d)}
      className="fixed top-3 right-4 z-50 font-mono text-xs text-muted-foreground"
      aria-label="Toggle dark mode"
    >
      {dark ? 'light' : 'dark'}
    </Button>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>nightshift</title>
        <HeadContent />
      </head>
      <body>
        <TooltipProvider>
          <ThemeToggle />
          {children}
        </TooltipProvider>
        <Scripts />
      </body>
    </html>
  );
}
