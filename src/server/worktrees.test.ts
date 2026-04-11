import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { initNightshift } from '~/cli/commands/init';
import { createGitRepo, createTmpDir, removeTmpDir } from '~/cli/test-helpers';
import { openDb } from '~/db/index';
import { getOpenProjectsByTeam } from '~/db/projects';
import {
  createProjectWithWorktree,
  findProjectWorktreePath,
} from './worktrees';

describe('findProjectWorktreePath', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    await createGitRepo(tmpDir);
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it('returns the worktree path when the branch has a worktree', async () => {
    const worktreeDir = join(tmpDir, '.nightshift', 'worktrees', 'my-project');
    await mkdir(join(tmpDir, '.nightshift', 'worktrees'), { recursive: true });
    execSync('git branch feature-wt', { cwd: tmpDir, stdio: 'pipe' });
    execSync(`git worktree add "${worktreeDir}" feature-wt`, {
      cwd: tmpDir,
      stdio: 'pipe',
    });

    const result = await findProjectWorktreePath(tmpDir, 'feature-wt');
    // Normalize paths to resolve macOS /var → /private/var symlink
    expect(result && (await realpath(result))).toBe(
      await realpath(worktreeDir),
    );
  });

  it('returns null when the branch has no worktree', async () => {
    execSync('git checkout -b no-worktree', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git checkout -', { cwd: tmpDir, stdio: 'pipe' });

    const result = await findProjectWorktreePath(tmpDir, 'no-worktree');
    expect(result).toBeNull();
  });

  it('returns null for an unknown branch', async () => {
    const result = await findProjectWorktreePath(tmpDir, 'nonexistent-branch');
    expect(result).toBeNull();
  });
});

describe('createProjectWithWorktree', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    await createGitRepo(tmpDir);
    await initNightshift(tmpDir);
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it('creates a git worktree at the specified path', async () => {
    const db = openDb(':memory:');
    const worktreePath = join(tmpDir, '.nightshift', 'worktrees', 'my-feature');
    await createProjectWithWorktree(
      tmpDir,
      worktreePath,
      'my-feature',
      'team',
      'my-feature',
      db,
    );
    expect(existsSync(worktreePath)).toBe(true);
    db.close();
  });

  it('inserts the project record into the DB', async () => {
    const db = openDb(':memory:');
    const worktreePath = join(tmpDir, '.nightshift', 'worktrees', 'my-feature');
    await createProjectWithWorktree(
      tmpDir,
      worktreePath,
      'my-feature',
      'team',
      'my-feature',
      db,
    );
    const projects = getOpenProjectsByTeam(db, 'team');
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('my-feature');
    expect(projects[0].branch).toBe('my-feature');
    db.close();
  });

  it('returns the created project record', async () => {
    const db = openDb(':memory:');
    const worktreePath = join(tmpDir, '.nightshift', 'worktrees', 'feat');
    const project = await createProjectWithWorktree(
      tmpDir,
      worktreePath,
      'My Feature',
      'team',
      'feat',
      db,
    );
    expect(project.name).toBe('My Feature');
    expect(project.branch).toBe('feat');
    expect(project.team_id).toBe('team');
    db.close();
  });

  it('preserves original name in DB while using branch for the worktree', async () => {
    const db = openDb(':memory:');
    const branch = 'my-feature';
    const worktreePath = join(tmpDir, '.nightshift', 'worktrees', branch);
    const project = await createProjectWithWorktree(
      tmpDir,
      worktreePath,
      'My Feature',
      'team',
      branch,
      db,
    );
    expect(project.name).toBe('My Feature');
    expect(project.branch).toBe('my-feature');
    db.close();
  });
});
