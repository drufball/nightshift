import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';

export async function createAgent(
  cwd: string,
  name: string,
  description?: string,
): Promise<void> {
  const agentsDir = join(cwd, '.nightshift', 'agents');

  try {
    await access(agentsDir);
  } catch {
    throw new Error('Not initialized: run `nightshift init` first');
  }

  const agentPath = join(agentsDir, `${name}.md`);
  try {
    await access(agentPath);
    throw new Error(`Agent already exists: ${name}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const content = `---
name: ${name}
description: ${description ?? ''}
---

You are ${name}.
`;

  await writeFile(agentPath, content);
}

export function registerAgent(program: Command): void {
  const agent = program.command('agent').description('Manage agents');

  agent
    .command('create <name>')
    .description('Create a new agent')
    .option('-d, --description <description>', 'Agent description')
    .action(async (name: string, options: { description?: string }) => {
      try {
        await createAgent(process.cwd(), name, options.description);
        console.log(`Created agent: .nightshift/agents/${name}.md`);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });
}
