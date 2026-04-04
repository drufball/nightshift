import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTmpDir, removeTmpDir, createGitRepo } from '../test-helpers';
import { createProject, mergeProject } from './project';
import { initNightshift } from './init';

describe('createProject', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    await createGitRepo(tmpDir);
    await initNightshift(tmpDir);
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it('creates worktree directory at .nightshift/worktrees/<name>', async () => {
    await createProject(tmpDir, 'my-feature', 'feature-team');
    expect(
      existsSync(join(tmpDir, '.nightshift', 'worktrees', 'my-feature')),
    ).toBe(true);
  });

  it('creates a new git branch named after the project', async () => {
    await createProject(tmpDir, 'my-feature', 'feature-team');
    const result = execSync('git branch --list my-feature', {
      cwd: tmpDir,
    }).toString();
    expect(result.trim()).toContain('my-feature');
  });

  it('throws if .nightshift does not exist', async () => {
    const uninitDir = await createTmpDir();
    await createGitRepo(uninitDir);
    try {
      await expect(
        createProject(uninitDir, 'my-feature', 'feature-team'),
      ).rejects.toThrow(/not initialized/i);
    } finally {
      await removeTmpDir(uninitDir);
    }
  });

  it('throws if project worktree already exists', async () => {
    await createProject(tmpDir, 'my-feature', 'feature-team');
    await expect(
      createProject(tmpDir, 'my-feature', 'feature-team'),
    ).rejects.toThrow(/already exists/i);
  });

  it('throws if name contains invalid characters', async () => {
    await expect(
      createProject(tmpDir, 'My Feature!', 'feature-team'),
    ).rejects.toThrow(/invalid.*name/i);
  });
});

describe('mergeProject', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    await createGitRepo(tmpDir);
    await initNightshift(tmpDir);
    await createProject(tmpDir, 'my-feature', 'feature-team');
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it('removes the worktree directory', async () => {
    await mergeProject(tmpDir, 'my-feature');
    expect(
      existsSync(join(tmpDir, '.nightshift', 'worktrees', 'my-feature')),
    ).toBe(false);
  });

  it('merges the branch into the current branch', async () => {
    const worktreePath = join(tmpDir, '.nightshift', 'worktrees', 'my-feature');
    await writeFile(join(worktreePath, 'feature.txt'), 'feature work');
    execSync('git add .', { cwd: worktreePath, stdio: 'pipe' });
    execSync('git commit -m "Feature work"', {
      cwd: worktreePath,
      stdio: 'pipe',
    });

    await mergeProject(tmpDir, 'my-feature');

    expect(existsSync(join(tmpDir, 'feature.txt'))).toBe(true);
  });

  it('removes the project branch after merge', async () => {
    await mergeProject(tmpDir, 'my-feature');
    const result = execSync('git branch --list my-feature', {
      cwd: tmpDir,
    }).toString();
    expect(result.trim()).toBe('');
  });

  it('throws if project does not exist', async () => {
    await expect(mergeProject(tmpDir, 'nonexistent')).rejects.toThrow(
      /not found/i,
    );
  });
});
