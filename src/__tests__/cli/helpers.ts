import { execSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function createTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nightshift-test-'));
}

export async function removeTmpDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Creates a real git repo with an initial commit so worktree operations work. */
export async function createGitRepo(dir: string): Promise<void> {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', {
    cwd: dir,
    stdio: 'pipe',
  });
  execSync('git config user.name "Test User"', { cwd: dir, stdio: 'pipe' });
  await writeFile(join(dir, 'README.md'), '# Test Repo');
  execSync('git add .', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "Initial commit"', { cwd: dir, stdio: 'pipe' });
}
