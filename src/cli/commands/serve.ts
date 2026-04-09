import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { Command } from 'commander';

export function registerServe(program: Command): void {
  program
    .command('serve')
    .description('Start the nightshift management UI')
    .option('--port <number>', 'Port to listen on', '3000')
    .action((opts: { port: string }) => {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.warn(
          '[nightshift] Warning: ANTHROPIC_API_KEY is not set.\n' +
            '  The conversation judge uses the Anthropic API directly and will fall back\n' +
            '  to the team lead on every turn until the key is configured.\n' +
            '  Fix: add  export ANTHROPIC_API_KEY=sk-ant-...  to your shell profile (~/.zshrc / ~/.bashrc).',
        );
      }

      // Resolve the package root from this file's location: src/cli/commands/ -> ../../..
      const packageRoot = join(import.meta.dir, '..', '..', '..');

      const projectDir = process.cwd();
      const child = spawn(
        'bun',
        ['--bun', 'run', 'vite', 'dev', '--port', opts.port],
        {
          cwd: packageRoot,
          stdio: 'inherit',
          env: { ...process.env, NIGHTSHIFT_PROJECT_DIR: projectDir },
        },
      );

      child.on('error', (err) => {
        console.error(`Failed to start server: ${err.message}`);
        process.exit(1);
      });

      child.on('exit', (code) => {
        process.exit(code ?? 0);
      });
    });
}
