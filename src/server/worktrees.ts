import type { Database } from '~/db/index';
import type { Project } from '~/db/projects';

/**
 * Returns the filesystem path of the worktree that has `branch` checked out,
 * or null if no worktree exists for that branch.
 */
export async function findProjectWorktreePath(
  cwd: string,
  branch: string,
): Promise<string | null> {
  const { execFileSync } = await import('node:child_process');
  let output: string;
  try {
    output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd,
      stdio: 'pipe',
    }).toString();
  } catch {
    return null;
  }
  // Porcelain format: blank-line-separated blocks of:
  //   worktree <path>
  //   HEAD <sha>
  //   branch refs/heads/<name>   (or "detached")
  for (const block of output.split('\n\n')) {
    const lines = block.split('\n');
    const pathLine = lines.find((l) => l.startsWith('worktree '));
    const branchLine = lines.find((l) => l.startsWith('branch '));
    if (!pathLine || !branchLine) continue;
    const worktreePath = pathLine.slice('worktree '.length).trim();
    const worktreeBranch = branchLine
      .slice('branch '.length)
      .trim()
      .replace(/^refs\/heads\//, '');
    if (worktreeBranch === branch) return worktreePath;
  }
  return null;
}

/**
 * Creates a git worktree at `worktreePath` on a new branch and inserts the
 * project record in the database. Used by both the CLI and server so that
 * project creation goes through a single code path.
 */
export async function createProjectWithWorktree(
  cwd: string,
  worktreePath: string,
  name: string,
  teamId: string,
  branch: string,
  db: Database,
): Promise<Project> {
  const { execFileSync } = await import('node:child_process');
  const { insertProject } = await import('~/db/projects');
  execFileSync('git', ['worktree', 'add', worktreePath, '-b', branch], {
    cwd,
    stdio: 'pipe',
  });
  return insertProject(db, name, teamId, branch);
}
