import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTmpDir, removeTmpDir } from '../test-helpers';
import { createAgent } from './agent';
import { initNightshift } from './init';

describe('createAgent', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    await initNightshift(tmpDir);
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it('creates agent markdown file in .nightshift/agents/', async () => {
    await createAgent(tmpDir, 'backend-dev');
    expect(
      existsSync(join(tmpDir, '.nightshift', 'agents', 'backend-dev.md')),
    ).toBe(true);
  });

  it('includes name in frontmatter', async () => {
    await createAgent(tmpDir, 'backend-dev');
    const contents = readFileSync(
      join(tmpDir, '.nightshift', 'agents', 'backend-dev.md'),
      'utf-8',
    );
    expect(contents).toContain('name: backend-dev');
  });

  it('includes description in frontmatter when provided', async () => {
    await createAgent(tmpDir, 'backend-dev', 'Owns the data pipeline');
    const contents = readFileSync(
      join(tmpDir, '.nightshift', 'agents', 'backend-dev.md'),
      'utf-8',
    );
    expect(contents).toContain('description: Owns the data pipeline');
  });

  it('includes empty description when not provided', async () => {
    await createAgent(tmpDir, 'backend-dev');
    const contents = readFileSync(
      join(tmpDir, '.nightshift', 'agents', 'backend-dev.md'),
      'utf-8',
    );
    expect(contents).toContain('description:');
  });

  it('includes frontmatter delimiters', async () => {
    await createAgent(tmpDir, 'backend-dev');
    const contents = readFileSync(
      join(tmpDir, '.nightshift', 'agents', 'backend-dev.md'),
      'utf-8',
    );
    expect(contents.startsWith('---\n')).toBe(true);
    expect(contents).toContain('\n---\n');
  });

  it('throws if .nightshift does not exist', async () => {
    const uninitDir = await createTmpDir();
    try {
      await expect(createAgent(uninitDir, 'backend-dev')).rejects.toThrow(
        /not initialized/i,
      );
    } finally {
      await removeTmpDir(uninitDir);
    }
  });

  it('throws if agent already exists', async () => {
    await createAgent(tmpDir, 'backend-dev');
    await expect(createAgent(tmpDir, 'backend-dev')).rejects.toThrow(
      /already exists/i,
    );
  });

  it('throws if name contains invalid characters', async () => {
    await expect(createAgent(tmpDir, 'My Agent!')).rejects.toThrow(
      /invalid.*name/i,
    );
  });
});
