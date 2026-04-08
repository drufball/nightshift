import { createServerFn } from '@tanstack/react-start';
import { resolveCwd } from './teams';

export interface FileEntry {
  name: string;
  type: 'file' | 'dir';
}

export interface DiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export async function readDiffIgnore(cwd: string): Promise<string[]> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  let content: string;
  try {
    content = await readFile(join(cwd, 'nightshift.toml'), 'utf8');
  } catch {
    return [];
  }
  const sectionMatch = content.match(/\[diff\]([\s\S]*?)(?:\n\[|$)/);
  if (!sectionMatch) return [];
  const ignoreMatch = sectionMatch[1].match(/^ignore\s*=\s*\[([\s\S]*?)\]/m);
  if (!ignoreMatch) return [];
  return ignoreMatch[1]
    .split('\n')
    .map((line) =>
      line.trim().replace(/,\s*$/, '').replace(/^"|"$/g, '').trim(),
    )
    .filter((s) => s.length > 0 && !s.startsWith('#'));
}

export async function listTeamFiles(
  cwd: string,
  teamId: string,
  subPath: string[],
): Promise<FileEntry[]> {
  const { readdir, stat } = await import('node:fs/promises');
  const { join, resolve } = await import('node:path');

  const teamBase = join(cwd, '.nightshift', 'teams', teamId);
  const dirPath = subPath.length > 0 ? join(teamBase, ...subPath) : teamBase;

  // Ensure we stay within the team directory
  const resolved = resolve(dirPath);
  const resolvedBase = resolve(teamBase);
  if (!resolved.startsWith(resolvedBase)) {
    return [];
  }

  let names: string[];
  try {
    names = await readdir(dirPath);
  } catch {
    return [];
  }

  const ignorePatterns = await readDiffIgnore(cwd);

  const entries: FileEntry[] = [];
  for (const name of names.sort()) {
    // Check if this file matches any ignore pattern
    if (ignorePatterns.length > 0) {
      const relativePath =
        subPath.length > 0 ? `${subPath.join('/')}/${name}` : name;
      if (matchesAnyPattern(relativePath, ignorePatterns)) continue;
    }
    try {
      const s = await stat(join(dirPath, name));
      entries.push({ name, type: s.isDirectory() ? 'dir' : 'file' });
    } catch {
      // skip
    }
  }
  return entries;
}

export async function readTeamFile(
  cwd: string,
  teamId: string,
  relPath: string[],
): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const { join, resolve } = await import('node:path');

  const teamBase = join(cwd, '.nightshift', 'teams', teamId);
  const filePath = join(teamBase, ...relPath);

  // Security: prevent path traversal
  const resolvedFile = resolve(filePath);
  const resolvedBase = resolve(teamBase);
  if (!resolvedFile.startsWith(resolvedBase)) {
    throw new Error('Path traversal detected');
  }

  return readFile(filePath, 'utf8');
}

export async function getProjectDiff(
  cwd: string,
  branch: string,
  projectName?: string,
): Promise<{ diff: string; stats: DiffStats }> {
  const { execFileSync } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const ignorePatterns = await readDiffIgnore(cwd);

  // Committed changes on the branch vs HEAD
  let rawDiff: string;
  try {
    rawDiff = execFileSync('git', ['diff', `HEAD...${branch}`], {
      cwd,
      stdio: 'pipe',
    }).toString();
  } catch {
    rawDiff = '';
  }

  let rawNumstat: string;
  try {
    rawNumstat = execFileSync(
      'git',
      ['diff', '--numstat', `HEAD...${branch}`],
      { cwd, stdio: 'pipe' },
    ).toString();
  } catch {
    rawNumstat = '';
  }

  // Uncommitted changes (staged + unstaged) in the project worktree
  const worktreePath = projectName
    ? join(cwd, '.nightshift', 'worktrees', projectName)
    : null;
  if (worktreePath && existsSync(worktreePath)) {
    let uncommittedDiff: string;
    try {
      uncommittedDiff = execFileSync('git', ['diff', 'HEAD'], {
        cwd: worktreePath,
        stdio: 'pipe',
      }).toString();
    } catch {
      uncommittedDiff = '';
    }

    let uncommittedNumstat: string;
    try {
      uncommittedNumstat = execFileSync('git', ['diff', '--numstat', 'HEAD'], {
        cwd: worktreePath,
        stdio: 'pipe',
      }).toString();
    } catch {
      uncommittedNumstat = '';
    }

    if (uncommittedDiff) rawDiff += uncommittedDiff;
    if (uncommittedNumstat) rawNumstat += `\n${uncommittedNumstat}`;
  }

  const diff = filterDiff(rawDiff, ignorePatterns);
  const numstat = filterNumstat(rawNumstat, ignorePatterns);
  const stats = parseNumstat(numstat);
  return { diff, stats };
}

/** Split unified diff into per-file sections and filter out ignored paths. */
function filterDiff(diff: string, ignorePatterns: string[]): string {
  if (!diff || ignorePatterns.length === 0) return diff;
  const sections = diff.split(/(?=^diff --git )/m);
  return sections
    .filter((section) => {
      const match = section.match(/^diff --git a\/(.+?) b\//m);
      if (!match) return true; // keep header sections
      return !matchesAnyPattern(match[1], ignorePatterns);
    })
    .join('');
}

/** Filter --numstat output lines for ignored paths. */
function filterNumstat(numstat: string, ignorePatterns: string[]): string {
  if (!numstat || ignorePatterns.length === 0) return numstat;
  return numstat
    .split('\n')
    .filter((line) => {
      if (!line.trim()) return false;
      const parts = line.split('\t');
      if (parts.length < 3) return true;
      const filePath = parts[2];
      return !matchesAnyPattern(filePath, ignorePatterns);
    })
    .join('\n');
}

function parseNumstat(numstat: string): DiffStats {
  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of numstat.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    if (parts.length < 2) continue;
    const added = Number.parseInt(parts[0], 10);
    const removed = Number.parseInt(parts[1], 10);
    if (!Number.isNaN(added) && !Number.isNaN(removed)) {
      filesChanged++;
      insertions += added;
      deletions += removed;
    }
  }
  return { filesChanged, insertions, deletions };
}

function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (matchGlob(pattern, filePath)) return true;
  }
  return false;
}

function globToRegex(pattern: string): RegExp {
  // Build regex char by char to avoid null-byte placeholder issues
  let re = '^';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      // ** — matches any path depth
      if (pattern[i + 2] === '/') {
        // **/ → optional leading path prefix (also matches root level)
        re += '(?:.+/)?';
        i += 3;
      } else {
        // ** at end or middle without slash
        re += '.*';
        i += 2;
      }
    } else if (c === '*') {
      re += '[^/]*';
      i++;
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if ('.+^${}()|[\\]'.includes(c)) {
      re += `\\${c}`;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  re += '$';
  return new RegExp(re);
}

function matchGlob(pattern: string, filePath: string): boolean {
  return globToRegex(pattern).test(filePath);
}

// ── Server functions ──────────────────────────────────────────────────────────

export const getTeamFiles = createServerFn({ method: 'GET' })
  .inputValidator((data: { teamId: string; subPath: string[] }) => data)
  .handler(async ({ data }) => {
    const cwd = await resolveCwd();
    return listTeamFiles(cwd, data.teamId, data.subPath);
  });

export const getTeamFileContent = createServerFn({ method: 'GET' })
  .inputValidator((data: { teamId: string; relPath: string[] }) => data)
  .handler(async ({ data }) => {
    const cwd = await resolveCwd();
    return readTeamFile(cwd, data.teamId, data.relPath);
  });

export const getProjectDiffFn = createServerFn({ method: 'GET' })
  .inputValidator((data: { branch: string; projectName?: string }) => data)
  .handler(async ({ data }) => {
    const cwd = await resolveCwd();
    return getProjectDiff(cwd, data.branch, data.projectName);
  });
