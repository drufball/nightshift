import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initNightshift } from '~/cli/commands/init';
import { createProject } from '~/cli/commands/project';
import { createGitRepo, createTmpDir, removeTmpDir } from '~/cli/test-helpers';
import { openDb } from '~/db/index';
import {
  getProjectDiff,
  listTeamFiles,
  readDiffIgnore,
  readTeamFile,
} from './artefacts';

describe('readDiffIgnore', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it('returns empty array when nightshift.toml does not exist', async () => {
    expect(await readDiffIgnore(tmpDir)).toEqual([]);
  });

  it('returns empty array when [diff] section is missing', async () => {
    await writeFile(join(tmpDir, 'nightshift.toml'), '[team]\nhome = ""\n');
    expect(await readDiffIgnore(tmpDir)).toEqual([]);
  });

  it('returns ignore patterns from [diff] section', async () => {
    await writeFile(
      join(tmpDir, 'nightshift.toml'),
      '[diff]\nignore = [\n  "**/*.test.ts",\n  "bun.lock",\n]\n',
    );
    expect(await readDiffIgnore(tmpDir)).toEqual(['**/*.test.ts', 'bun.lock']);
  });
});

describe('listTeamFiles', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it('returns empty array when team dir does not exist', async () => {
    const entries = await listTeamFiles(tmpDir, 'no-team', []);
    expect(entries).toEqual([]);
  });

  it('lists files and directories in team dir root', async () => {
    const teamDir = join(tmpDir, '.nightshift', 'teams', 'my-team');
    await mkdir(join(teamDir, 'subdir'), { recursive: true });
    await writeFile(join(teamDir, 'notes.md'), '# Notes');
    await writeFile(join(teamDir, 'team.toml'), 'name = "my-team"');

    const entries = await listTeamFiles(tmpDir, 'my-team', []);
    const names = entries.map((e) => e.name).sort();
    expect(names).toContain('notes.md');
    expect(names).toContain('team.toml');
    expect(names).toContain('subdir');
  });

  it('marks directories with type "dir" and files with type "file"', async () => {
    const teamDir = join(tmpDir, '.nightshift', 'teams', 'my-team');
    await mkdir(join(teamDir, 'subdir'), { recursive: true });
    await writeFile(join(teamDir, 'file.md'), '# File');

    const entries = await listTeamFiles(tmpDir, 'my-team', []);
    const dirEntry = entries.find((e) => e.name === 'subdir');
    const fileEntry = entries.find((e) => e.name === 'file.md');
    expect(dirEntry?.type).toBe('dir');
    expect(fileEntry?.type).toBe('file');
  });

  it('filters files matching nightshift.toml ignore patterns', async () => {
    await writeFile(
      join(tmpDir, 'nightshift.toml'),
      '[diff]\nignore = ["**/*.secret"]\n',
    );
    const teamDir = join(tmpDir, '.nightshift', 'teams', 'my-team');
    await mkdir(teamDir, { recursive: true });
    await writeFile(join(teamDir, 'notes.md'), '# Notes');
    await writeFile(join(teamDir, 'passwords.secret'), 'top secret');

    const entries = await listTeamFiles(tmpDir, 'my-team', []);
    expect(entries.map((e) => e.name)).toContain('notes.md');
    expect(entries.map((e) => e.name)).not.toContain('passwords.secret');
  });

  it('lists files in subdirectory', async () => {
    const teamDir = join(tmpDir, '.nightshift', 'teams', 'my-team');
    await mkdir(join(teamDir, 'subdir'), { recursive: true });
    await writeFile(join(teamDir, 'subdir', 'deep.md'), '# Deep');

    const entries = await listTeamFiles(tmpDir, 'my-team', ['subdir']);
    expect(entries.map((e) => e.name)).toContain('deep.md');
  });
});

describe('readTeamFile', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it('returns file content', async () => {
    const teamDir = join(tmpDir, '.nightshift', 'teams', 'my-team');
    await mkdir(teamDir, { recursive: true });
    await writeFile(join(teamDir, 'notes.md'), '# Notes\nHello world');

    const content = await readTeamFile(tmpDir, 'my-team', ['notes.md']);
    expect(content).toBe('# Notes\nHello world');
  });

  it('reads files in subdirectories', async () => {
    const teamDir = join(tmpDir, '.nightshift', 'teams', 'my-team', 'subdir');
    await mkdir(teamDir, { recursive: true });
    await writeFile(join(teamDir, 'deep.md'), '# Deep content');

    const content = await readTeamFile(tmpDir, 'my-team', [
      'subdir',
      'deep.md',
    ]);
    expect(content).toBe('# Deep content');
  });

  it('rejects path traversal attempts', async () => {
    const teamDir = join(tmpDir, '.nightshift', 'teams', 'my-team');
    await mkdir(teamDir, { recursive: true });

    await expect(
      readTeamFile(tmpDir, 'my-team', ['..', '..', 'etc', 'passwd']),
    ).rejects.toThrow();
  });
});

describe('getProjectDiff', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    await createGitRepo(tmpDir);
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it('returns empty diff when branch has no changes', async () => {
    execSync('git checkout -b feature-empty', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git checkout -', { cwd: tmpDir, stdio: 'pipe' });

    const result = await getProjectDiff(tmpDir, 'feature-empty');
    expect(result.diff).toBe('');
    expect(result.stats.filesChanged).toBe(0);
    expect(result.stats.insertions).toBe(0);
    expect(result.stats.deletions).toBe(0);
  });

  it('returns diff for branch changes', async () => {
    execSync('git checkout -b feature-change', { cwd: tmpDir, stdio: 'pipe' });
    await writeFile(join(tmpDir, 'new-file.md'), '# New\nAdded content');
    execSync('git add new-file.md', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "Add new file"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git checkout -', { cwd: tmpDir, stdio: 'pipe' });

    const result = await getProjectDiff(tmpDir, 'feature-change');
    expect(result.diff).toContain('new-file.md');
    expect(result.diff).toContain('+# New');
    expect(result.stats.filesChanged).toBeGreaterThan(0);
    expect(result.stats.insertions).toBeGreaterThan(0);
  });

  it('filters ignored files from diff', async () => {
    await writeFile(
      join(tmpDir, 'nightshift.toml'),
      '[diff]\nignore = ["**/*.log"]\n',
    );
    execSync('git add nightshift.toml', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "Add config"', { cwd: tmpDir, stdio: 'pipe' });

    execSync('git checkout -b feature-ignore', { cwd: tmpDir, stdio: 'pipe' });
    await writeFile(join(tmpDir, 'app.js'), 'console.log("hello")');
    await writeFile(join(tmpDir, 'debug.log'), 'some log output');
    execSync('git add .', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "Add files"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git checkout -', { cwd: tmpDir, stdio: 'pipe' });

    const result = await getProjectDiff(tmpDir, 'feature-ignore');
    expect(result.diff).toContain('app.js');
    expect(result.diff).not.toContain('debug.log');
  });

  it('returns stats reflecting only non-ignored files', async () => {
    await writeFile(
      join(tmpDir, 'nightshift.toml'),
      '[diff]\nignore = ["ignored.txt"]\n',
    );
    execSync('git add nightshift.toml', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "Add config"', { cwd: tmpDir, stdio: 'pipe' });

    execSync('git checkout -b feature-stats', { cwd: tmpDir, stdio: 'pipe' });
    await writeFile(join(tmpDir, 'kept.md'), '# Kept\nLine 1\nLine 2');
    await writeFile(join(tmpDir, 'ignored.txt'), 'ignored content');
    execSync('git add .', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "Add files"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git checkout -', { cwd: tmpDir, stdio: 'pipe' });

    const result = await getProjectDiff(tmpDir, 'feature-stats');
    // Only kept.md should count, not ignored.txt
    expect(result.stats.filesChanged).toBe(1);
  });

  it('includes uncommitted (unstaged) changes from project worktree', async () => {
    // Create the branch without checking it out, then add a worktree for it
    const worktreeDir = join(tmpDir, '.nightshift', 'worktrees', 'my-project');
    execSync('git branch feature-wt', { cwd: tmpDir, stdio: 'pipe' });
    execSync(`git worktree add "${worktreeDir}" feature-wt`, {
      cwd: tmpDir,
      stdio: 'pipe',
    });

    // Modify the existing tracked README.md without staging or committing
    await writeFile(join(worktreeDir, 'README.md'), '# Modified\nNew content');

    const result = await getProjectDiff(tmpDir, 'feature-wt');
    expect(result.diff).toContain('README.md');
    expect(result.diff).toContain('+# Modified');
    expect(result.stats.filesChanged).toBeGreaterThan(0);
  });

  it('includes staged (not yet committed) changes from project worktree', async () => {
    const worktreeDir = join(tmpDir, '.nightshift', 'worktrees', 'my-project');
    execSync('git branch feature-staged', { cwd: tmpDir, stdio: 'pipe' });
    execSync(`git worktree add "${worktreeDir}" feature-staged`, {
      cwd: tmpDir,
      stdio: 'pipe',
    });

    // Stage a new file without committing
    await writeFile(join(worktreeDir, 'staged.md'), '# Staged\nNew content');
    execSync('git add staged.md', { cwd: worktreeDir, stdio: 'pipe' });

    const result = await getProjectDiff(tmpDir, 'feature-staged');
    expect(result.diff).toContain('staged.md');
    expect(result.diff).toContain('+# Staged');
    expect(result.stats.filesChanged).toBeGreaterThan(0);
  });

  it('includes committed, staged, and unstaged changes together', async () => {
    // Committed change on branch
    execSync('git checkout -b feature-all', { cwd: tmpDir, stdio: 'pipe' });
    await writeFile(join(tmpDir, 'committed.md'), '# Committed\nContent');
    execSync('git add committed.md', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "Add committed file"', {
      cwd: tmpDir,
      stdio: 'pipe',
    });
    execSync('git checkout -', { cwd: tmpDir, stdio: 'pipe' });

    const worktreeDir = join(tmpDir, '.nightshift', 'worktrees', 'my-project');
    execSync(`git worktree add "${worktreeDir}" feature-all`, {
      cwd: tmpDir,
      stdio: 'pipe',
    });

    // Staged change in worktree
    await writeFile(join(worktreeDir, 'staged.md'), '# Staged\nContent');
    execSync('git add staged.md', { cwd: worktreeDir, stdio: 'pipe' });

    // Unstaged change in worktree
    await writeFile(
      join(worktreeDir, 'README.md'),
      '# Modified README\nUnstaged change',
    );

    const result = await getProjectDiff(tmpDir, 'feature-all');
    expect(result.diff).toContain('committed.md');
    expect(result.diff).toContain('staged.md');
    expect(result.diff).toContain('README.md');
    expect(result.stats.filesChanged).toBeGreaterThanOrEqual(3);
  });

  it('shows unified diff for file with both committed and uncommitted changes', async () => {
    // Commit a change to README.md on the branch
    execSync('git checkout -b feature-overlap', { cwd: tmpDir, stdio: 'pipe' });
    await writeFile(join(tmpDir, 'README.md'), '# Committed README');
    execSync('git add README.md', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "Modify README"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git checkout -', { cwd: tmpDir, stdio: 'pipe' });

    const worktreeDir = join(tmpDir, '.nightshift', 'worktrees', 'my-project');
    execSync(`git worktree add "${worktreeDir}" feature-overlap`, {
      cwd: tmpDir,
      stdio: 'pipe',
    });

    // Additional uncommitted change to the same file
    await writeFile(join(worktreeDir, 'README.md'), '# Working README');

    const result = await getProjectDiff(tmpDir, 'feature-overlap');

    // Should appear only once (not duplicated as committed section + uncommitted section)
    expect(result.diff.match(/diff --git a\/README\.md/g)?.length).toBe(1);

    // Stats should count README.md once, not twice
    expect(result.stats.filesChanged).toBe(1);

    // Should show total change: original → working (not original → committed)
    expect(result.diff).toContain('-# Test Repo');
    expect(result.diff).toContain('+# Working README');
  });
});

describe('getProjectDiff (integration with createProject)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    await createGitRepo(tmpDir);
    await initNightshift(tmpDir);
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it('shows unstaged tracked changes from a project created via createProject', async () => {
    const db = openDb(':memory:');
    await createProject(tmpDir, 'my-feature', 'team', db);

    const worktreeDir = join(tmpDir, '.nightshift', 'worktrees', 'my-feature');

    // Make an unstaged tracked change in the worktree
    await writeFile(join(worktreeDir, 'README.md'), '# Work in progress');

    const result = await getProjectDiff(tmpDir, 'my-feature');
    expect(result.diff).toContain('README.md');
    expect(result.diff).toContain('+# Work in progress');
    expect(result.stats.filesChanged).toBeGreaterThan(0);
  });

  it('shows staged (not committed) changes from a project created via createProject', async () => {
    const db = openDb(':memory:');
    await createProject(tmpDir, 'my-feature', 'team', db);

    const worktreeDir = join(tmpDir, '.nightshift', 'worktrees', 'my-feature');

    // Make a staged change in the worktree
    await writeFile(join(worktreeDir, 'new-work.md'), '# New work');
    execSync('git add new-work.md', { cwd: worktreeDir, stdio: 'pipe' });

    const result = await getProjectDiff(tmpDir, 'my-feature');
    expect(result.diff).toContain('new-work.md');
    expect(result.diff).toContain('+# New work');
    expect(result.stats.filesChanged).toBeGreaterThan(0);
  });
});
