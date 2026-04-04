import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import { assertInitialized, assertNotExists, assertValidName } from '../fs';

export async function createTeam(
  cwd: string,
  name: string,
  lead: string,
  members: string[],
): Promise<void> {
  assertValidName(name, 'team');
  assertValidName(lead, 'agent');
  for (const m of members) assertValidName(m, 'agent');

  await assertInitialized(cwd);

  const teamDir = join(cwd, '.nightshift', 'teams', name);
  await assertNotExists(teamDir, `Team already exists: ${name}`);

  await mkdir(teamDir, { recursive: true });

  const membersToml =
    members.length === 0
      ? 'members = []'
      : `members = [${members.map((m) => `"${m}"`).join(', ')}]`;

  const content = `name = "${name}"
lead = "${lead}"
${membersToml}
`;

  await writeFile(join(teamDir, 'team.toml'), content);
}

export function registerTeam(program: Command): void {
  const team = program.command('team').description('Manage teams');

  team
    .command('create <name>')
    .description('Create a new team')
    .requiredOption('--lead <agent>', 'Lead agent for the team')
    .option(
      '--member <agent>',
      'Add a member (repeatable)',
      (val: string, acc: string[]) => [...acc, val],
      [] as string[],
    )
    .action(
      async (name: string, options: { lead: string; member: string[] }) => {
        try {
          await createTeam(process.cwd(), name, options.lead, options.member);
          console.log(`Created team: .nightshift/teams/${name}/`);
        } catch (err) {
          console.error((err as Error).message);
          process.exit(1);
        }
      },
    );
}
