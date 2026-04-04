import { Database } from 'bun:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { CREATE_TABLES } from './schema';

export type { Database };

export function getDbPath(cwd: string): string {
  const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    stdio: 'pipe',
  })
    .toString()
    .trim();
  const slug = basename(gitRoot);
  return join(homedir(), '.nightshift', slug, 'nightshift.db');
}

export function openDb(dbPath: string): Database {
  if (dbPath !== ':memory:') {
    const dir = dbPath.substring(0, dbPath.lastIndexOf('/'));
    mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(CREATE_TABLES);
  return db;
}
