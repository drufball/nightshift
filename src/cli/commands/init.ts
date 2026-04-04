import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';

const NIGHTSHIFT_TOML = `[diff]
ignore = [
  "**/*.test.ts",
  "**/*.spec.ts",
  "src/generated/**",
  "pnpm-lock.yaml",
]
`;

const GITIGNORE = `worktrees/
`;

const AGENTS: Record<string, string> = {
  'project-lead': `---
name: project-lead
description: Coordinates the team, delegates tasks, and communicates with stakeholders.
---

You are the project lead for this team. You are responsible for understanding
the full context of what needs to be done, breaking work into clear tasks, and
coordinating with team members to get it done.

When given a request, start by understanding the goal. Then delegate to the
appropriate team members in sequence, providing each with clear context on what
they need to do and why. Review their work before moving on.
`,
  'product-manager': `---
name: product-manager
description: Defines requirements and ensures work aligns with user needs.
---

You are the product manager for this team. You are responsible for understanding
user needs and translating them into clear, actionable requirements.

When given a task, start by clarifying what success looks like. Document
requirements clearly so engineers have everything they need to implement correctly.
`,
  'tech-lead': `---
name: tech-lead
description: Breaks down requirements into tasks and leads implementation.
---

You are the tech lead for this project. You have deep familiarity with the
codebase and are responsible for translating product requirements into a
concrete implementation plan and writing the code to execute it.

When given a task, start by reading the relevant files to understand the
current state before making any changes.
`,
};

const FEATURE_TEAM_TOML = `name = "feature-team"
lead = "project-lead"
members = ["product-manager", "tech-lead"]
`;

export async function initNightshift(cwd: string): Promise<void> {
  const nightshiftDir = join(cwd, '.nightshift');

  try {
    await access(nightshiftDir);
    throw new Error(
      'Already initialized: .nightshift directory already exists',
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  await writeFile(join(cwd, 'nightshift.toml'), NIGHTSHIFT_TOML);

  await mkdir(join(nightshiftDir, 'agents'), { recursive: true });
  await mkdir(join(nightshiftDir, 'teams', 'feature-team'), {
    recursive: true,
  });
  await mkdir(join(nightshiftDir, 'worktrees'), { recursive: true });

  await writeFile(join(nightshiftDir, '.gitignore'), GITIGNORE);

  for (const [name, content] of Object.entries(AGENTS)) {
    await writeFile(join(nightshiftDir, 'agents', `${name}.md`), content);
  }

  await writeFile(
    join(nightshiftDir, 'teams', 'feature-team', 'team.toml'),
    FEATURE_TEAM_TOML,
  );
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Initialize nightshift in the current directory')
    .action(async () => {
      try {
        await initNightshift(process.cwd());
        console.log(
          'Initialized nightshift. Edit .nightshift/agents/ to customize your team.',
        );
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });
}
