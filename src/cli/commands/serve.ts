import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { Command } from 'commander';

export function registerServe(program: Command): void {
  program
    .command('serve')
    .description('Start the nightshift management UI')
    .option('--port <number>', 'Port to listen on', '3000')
    .action((opts: { port: string }) => {
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
