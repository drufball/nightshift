import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';

/**
 * Parse a .env file into a key→value map.
 * Skips blank lines and `#` comments. Strips surrounding quotes and inline comments.
 * Later values for the same key win.
 */
function parseDotenv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    } else {
      // Strip inline comment (unquoted values only)
      const commentIdx = val.indexOf(' #');
      if (commentIdx !== -1) val = val.slice(0, commentIdx).trimEnd();
    }
    if (key) result[key] = val;
  }
  return result;
}

/**
 * Load env vars from the project directory.
 * Priority (highest last, so it wins in spread): process.env → .env → .nightshift/.env
 * Returns only the file-sourced vars; callers merge with process.env themselves.
 */
export function loadProjectEnv(projectDir: string): Record<string, string> {
  const read = (path: string): Record<string, string> => {
    try {
      return parseDotenv(readFileSync(path, 'utf-8'));
    } catch {
      return {};
    }
  };

  return {
    ...read(join(projectDir, '.env')),
    ...read(join(projectDir, '.nightshift', '.env')),
  };
}

export function registerServe(program: Command): void {
  program
    .command('serve')
    .description('Start the nightshift management UI')
    .option('--port <number>', 'Port to listen on', '3000')
    .action((opts: { port: string }) => {
      // Resolve the package root from this file's location: src/cli/commands/ -> ../../..
      const packageRoot = join(import.meta.dir, '..', '..', '..');

      const projectDir = process.cwd();
      const fileEnv = loadProjectEnv(projectDir);

      if (!process.env.ANTHROPIC_API_KEY && !fileEnv.ANTHROPIC_API_KEY) {
        console.warn(
          '[nightshift] Warning: ANTHROPIC_API_KEY is not set.\n' +
            '  The conversation judge uses the Anthropic API directly and will fall back\n' +
            '  to the team lead on every turn until the key is configured.\n' +
            '  Set it in .nightshift/.env, .env, or your shell profile (~/.zshrc / ~/.bashrc).',
        );
      }

      // Merge order: process.env (lowest) → .env → .nightshift/.env (highest)
      const env = {
        ...process.env,
        ...fileEnv,
        NIGHTSHIFT_PROJECT_DIR: projectDir,
      };

      const child = spawn(
        'bun',
        ['--bun', 'run', 'vite', 'dev', '--port', opts.port],
        {
          cwd: packageRoot,
          stdio: 'inherit',
          env,
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
