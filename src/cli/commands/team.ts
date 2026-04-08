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
  await writeFile(join(teamDir, 'MISSION.md'), MISSION_TEMPLATE);
  await writeFile(join(teamDir, 'MEMORY.md'), MEMORY_TEMPLATE);
  await writeFile(join(teamDir, 'DECISIONS.md'), DECISIONS_TEMPLATE);
}

const MISSION_TEMPLATE = `# Mission

<!-- One paragraph: what is this team for and why does it exist? -->

## Ownership
<!-- What does this team own? Cover the relevant dimensions: product surfaces, code areas, processes, integrations, etc. -->

## Goals
<!-- What is this team focused on right now? List 1–3 active goals. -->

## Common Tasks
<!-- Recurring tasks this team runs, so agents know what "normal work" looks like -->
`;

const MEMORY_TEMPLATE = `# Memory

A running log of patterns, preferences, and lessons this team has learned.
Append new entries at the top. Include a date.

---

<!-- Entry format:
## YYYY-MM-DD — Title
What happened and what we learned.
-->
`;

const DECISIONS_TEMPLATE = `# Decisions

Key decisions made by this team. Record decisions here so agents and humans
don't re-litigate them.

| Date | Decision | Rationale | Status |
|------|----------|-----------|--------|
| | | | |
`;

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
