import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProjectEnv } from './serve';

describe('loadProjectEnv', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ns-serve-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty object when neither env file exists', () => {
    expect(loadProjectEnv(dir)).toEqual({});
  });

  it('parses a .env file', () => {
    writeFileSync(join(dir, '.env'), 'FOO=bar\nBAZ=qux\n');
    expect(loadProjectEnv(dir)).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('parses a .nightshift/.env file', () => {
    mkdirSync(join(dir, '.nightshift'));
    writeFileSync(join(dir, '.nightshift', '.env'), 'HELLO=world\n');
    expect(loadProjectEnv(dir)).toEqual({ HELLO: 'world' });
  });

  it('.nightshift/.env values override .env values for the same key', () => {
    writeFileSync(join(dir, '.env'), 'KEY=from-dotenv\nOTHER=keep\n');
    mkdirSync(join(dir, '.nightshift'));
    writeFileSync(join(dir, '.nightshift', '.env'), 'KEY=from-nightshift\n');
    expect(loadProjectEnv(dir)).toEqual({
      KEY: 'from-nightshift',
      OTHER: 'keep',
    });
  });

  it('skips comment lines and blank lines', () => {
    writeFileSync(join(dir, '.env'), '# comment\n\nKEY=val\n');
    expect(loadProjectEnv(dir)).toEqual({ KEY: 'val' });
  });

  it('strips inline comments after a value', () => {
    writeFileSync(join(dir, '.env'), 'KEY=value # comment\n');
    expect(loadProjectEnv(dir)).toEqual({ KEY: 'value' });
  });

  it('strips surrounding quotes from values', () => {
    writeFileSync(
      join(dir, '.env'),
      'A="double quoted"\nB=\'single quoted\'\n',
    );
    expect(loadProjectEnv(dir)).toEqual({
      A: 'double quoted',
      B: 'single quoted',
    });
  });

  it('handles values with = signs inside them', () => {
    writeFileSync(join(dir, '.env'), 'URL=https://example.com?a=1&b=2\n');
    expect(loadProjectEnv(dir)).toEqual({ URL: 'https://example.com?a=1&b=2' });
  });
});
