import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import { assertInitialized, assertNotExists, assertValidName } from '../fs';

export async function createAgent(
  cwd: string,
  name: string,
  description?: string,
): Promise<void> {
  assertValidName(name, 'agent');
  await assertInitialized(cwd);

  const agentPath = join(cwd, '.nightshift', 'agents', `${name}.md`);
  await assertNotExists(agentPath, `Agent already exists: ${name}`);

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
