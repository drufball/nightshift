import { execFileSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import type { Database } from '~/db/index';
import { getDbPath, openDb } from '~/db/index';
import {
  branchExists,
  getOpenProjectsByName,
  markProjectMerged,
} from '~/db/projects';
import { createProjectWithWorktree } from '~/server/worktrees';
import { assertInitialized, assertNotExists, assertValidName } from '../fs';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
}

function shortId(): string {
  return Math.random().toString(16).slice(2, 6);
}

function resolveBranch(db: Database, name: string): string {
  return branchExists(db, name) ? `${name}-${shortId()}` : name;
}

export async function createProject(
  cwd: string,
  name: string,
  team: string,
  db?: Database,
): Promise<void> {
  assertValidName(name, 'project');
  await assertInitialized(cwd);

  const resolvedDb = db ?? openDb(getDbPath(cwd));
  const branch = resolveBranch(resolvedDb, name);
  const worktreePath = join(cwd, '.nightshift', 'worktrees', name);
  await assertNotExists(worktreePath, `Project already exists: ${name}`);

  await createProjectWithWorktree(
    cwd,
    worktreePath,
    name,
    team,
    branch,
    resolvedDb,
  );
}

export async function mergeProject(
  cwd: string,
  name: string,
  db?: Database,
): Promise<void> {
  const worktreePath = join(cwd, '.nightshift', 'worktrees', name);
  try {
    await access(worktreePath);
  } catch {
    throw new Error(`Project not found: ${name}`);
  }

  const resolvedDb = db ?? openDb(getDbPath(cwd));

  // Find matching open branch (may have suffix appended)
  const branches = git(['branch', '--list', `${name}*`], cwd)
    .split('\n')
    .map((b) => b.trim().replace(/^[*+]\s*/, ''))
    .filter(Boolean);
  const branch = branches[0] ?? name;

  const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  git(['merge', branch], cwd);
  git(['worktree', 'remove', worktreePath, '--force'], cwd);
  if (currentBranch !== branch) {
    git(['branch', '-d', branch], cwd);
  }

  // Mark all open projects with this name as merged
  const openByName = getOpenProjectsByName(resolvedDb, name);
  for (const p of openByName) {
    markProjectMerged(resolvedDb, p.id);
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
