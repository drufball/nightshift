import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    fs: {
      // When running from a git worktree, node_modules lives in the parent
      // repo rather than the worktree itself. Expand the allow list so Vite
      // can serve those files (e.g. the TanStack Start client entry).
      allow: [searchForWorkspaceRoot(process.cwd()), '../../..'],
    },
  },
  resolve: {
    alias: {
      '~': '/src',
    },
  },
  plugins: [tailwindcss(), tanstackStart({ srcDirectory: 'src' }), viteReact()],
});
