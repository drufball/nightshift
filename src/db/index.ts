import { Database } from 'bun:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
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
    const dir = dirname(dbPath);
    mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(CREATE_TABLES);
  // Migrations for columns added after initial schema
  try {
    db.exec('ALTER TABLE agent_sessions ADD COLUMN sdk_session_id TEXT;');
  } catch {
    // Column already exists — safe to ignore
  }
  return db;
}
