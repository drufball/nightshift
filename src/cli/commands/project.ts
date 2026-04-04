import { execSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, { cwd, stdio: 'pipe' }).toString().trim();
}

export async function createProject(
  cwd: string,
  name: string,
  _team: string,
): Promise<void> {
  const nightshiftDir = join(cwd, '.nightshift');
  try {
    await access(nightshiftDir);
  } catch {
    throw new Error('Not initialized: run `nightshift init` first');
  }

  const worktreePath = join(nightshiftDir, 'worktrees', name);
  try {
    await access(worktreePath);
    throw new Error(`Project already exists: ${name}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  git(`worktree add "${worktreePath}" -b "${name}"`, cwd);
}

export async function mergeProject(cwd: string, name: string): Promise<void> {
  const worktreePath = join(cwd, '.nightshift', 'worktrees', name);

  try {
    await access(worktreePath);
  } catch {
    throw new Error(`Project not found: ${name}`);
  }

  const currentBranch = git('rev-parse --abbrev-ref HEAD', cwd);
  git(`merge "${name}"`, cwd);
  git(`worktree remove "${worktreePath}" --force`, cwd);

  // Only delete the branch if we successfully merged and aren't on it
  if (currentBranch !== name) {
    git(`branch -d "${name}"`, cwd);
  }
}

export function registerProject(program: Command): void {
  const project = program.command('project').description('Manage projects');

  project
    .command('create <name>')
    .description('Create a new project (opens a branch and worktree)')
    .requiredOption('--team <team>', 'Team to work on this project')
    .action(async (name: string, options: { team: string }) => {
      try {
        await createProject(process.cwd(), name, options.team);
        console.log(`Created project: .nightshift/worktrees/${name}`);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });

  project
    .command('merge <name>')
    .description(
      'Merge a project branch into the current branch and remove its worktree',
    )
    .action(async (name: string) => {
      try {
        await mergeProject(process.cwd(), name);
        console.log(`Merged and cleaned up project: ${name}`);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });
}
