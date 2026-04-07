import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createGitRepo, createTmpDir, removeTmpDir } from '~/cli/test-helpers';
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
    execSync('git checkout main', { cwd: tmpDir, stdio: 'pipe' });

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
    execSync('git checkout main', { cwd: tmpDir, stdio: 'pipe' });

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
    execSync('git checkout main', { cwd: tmpDir, stdio: 'pipe' });

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
    execSync('git checkout main', { cwd: tmpDir, stdio: 'pipe' });

    const result = await getProjectDiff(tmpDir, 'feature-stats');
    // Only kept.md should count, not ignored.txt
    expect(result.stats.filesChanged).toBe(1);
  });
});
