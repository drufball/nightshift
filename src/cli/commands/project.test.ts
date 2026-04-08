import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Command } from 'commander';
import { openDb } from '~/db/index';
import { getOpenProjectsByTeam } from '~/db/projects';
import { createGitRepo, createTmpDir, removeTmpDir } from '../test-helpers';
import { initNightshift } from './init';
import { createProject, mergeProject, registerProject } from './project';

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

  it('persists the project to the DB', async () => {
    const db = openDb(':memory:');
    await createProject(tmpDir, 'my-feature', 'feature-team', db);
    const projects = getOpenProjectsByTeam(db, 'feature-team');
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('my-feature');
    expect(projects[0].branch).toBe('my-feature');
    db.close();
  });

  it('records the project branch in DB matching what git created', async () => {
    const db = openDb(':memory:');
    await createProject(tmpDir, 'my-feature', 'feature-team', db);
    const projects = getOpenProjectsByTeam(db, 'feature-team');
    // Branch was created by git — whatever name was used should match DB
    expect(projects[0].branch).toMatch(/^my-feature/);
    db.close();
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

describe('registerProject', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    await createGitRepo(tmpDir);
    await initNightshift(tmpDir);
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it('registers "project create" and "project merge" subcommands', () => {
    const program = new Command();
    program.exitOverride();
    registerProject(program);
    const projectCmd = program.commands.find((c) => c.name() === 'project');
    expect(projectCmd).toBeDefined();
    const createCmd = projectCmd?.commands.find((c) => c.name() === 'create');
    expect(createCmd).toBeDefined();
    const mergeCmd = projectCmd?.commands.find((c) => c.name() === 'merge');
    expect(mergeCmd).toBeDefined();
  });

  it('project create action calls process.exit(1) on invalid name', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation(
      (_code?: number) => undefined as never,
    );
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    const program = new Command();
    program.exitOverride();
    registerProject(program);
    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    try {
      await program.parseAsync(
        ['project', 'create', 'Bad Name!', '--team', 'feature-team'],
        { from: 'user' },
      );
    } catch {
      // commander exitOverride may throw on parse errors
    }
    process.cwd = origCwd;
    // Check before mockRestore — Bun clears mock.calls on restore
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('project create action logs success and creates worktree', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command();
    program.exitOverride();
    registerProject(program);
    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    try {
      await program.parseAsync(
        ['project', 'create', 'my-feature', '--team', 'feature-team'],
        { from: 'user' },
      );
    } catch {
      // no-op
    }
    process.cwd = origCwd;
    // Check before mockRestore — Bun clears mock.calls on restore
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('my-feature'));
    logSpy.mockRestore();
    expect(
      existsSync(join(tmpDir, '.nightshift', 'worktrees', 'my-feature')),
    ).toBe(true);
  });

  it('project merge action calls process.exit(1) for nonexistent project', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation(
      (_code?: number) => undefined as never,
    );
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    const program = new Command();
    program.exitOverride();
    registerProject(program);
    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    try {
      await program.parseAsync(['project', 'merge', 'nonexistent'], {
        from: 'user',
      });
    } catch {
      // no-op
    }
    process.cwd = origCwd;
    // Check before mockRestore — Bun clears mock.calls on restore
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});
