import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTmpDir, removeTmpDir } from '../test-helpers';
import { initNightshift } from './init';

describe('initNightshift', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it('creates nightshift.toml', async () => {
    await initNightshift(tmpDir);
    expect(existsSync(join(tmpDir, 'nightshift.toml'))).toBe(true);
  });

  it('nightshift.toml contains diff.ignore config', async () => {
    await initNightshift(tmpDir);
    const contents = readFileSync(join(tmpDir, 'nightshift.toml'), 'utf-8');
    expect(contents).toContain('[diff]');
    expect(contents).toContain('ignore');
  });

  it('nightshift.toml ignores bun.lock not pnpm-lock.yaml', async () => {
    await initNightshift(tmpDir);
    const contents = readFileSync(join(tmpDir, 'nightshift.toml'), 'utf-8');
    expect(contents).toContain('bun.lock');
    expect(contents).not.toContain('pnpm-lock.yaml');
  });

  it('creates .nightshift/agents directory', async () => {
    await initNightshift(tmpDir);
    expect(existsSync(join(tmpDir, '.nightshift', 'agents'))).toBe(true);
  });

  it('creates .nightshift/teams directory', async () => {
    await initNightshift(tmpDir);
    expect(existsSync(join(tmpDir, '.nightshift', 'teams'))).toBe(true);
  });

  it('creates .nightshift/worktrees directory', async () => {
    await initNightshift(tmpDir);
    expect(existsSync(join(tmpDir, '.nightshift', 'worktrees'))).toBe(true);
  });

  it('creates starter project-lead agent', async () => {
    await initNightshift(tmpDir);
    const agentPath = join(tmpDir, '.nightshift', 'agents', 'project-lead.md');
    expect(existsSync(agentPath)).toBe(true);
    const contents = readFileSync(agentPath, 'utf-8');
    expect(contents).toContain('name: project-lead');
  });

  it('creates starter product-manager agent', async () => {
    await initNightshift(tmpDir);
    const agentPath = join(
      tmpDir,
      '.nightshift',
      'agents',
      'product-manager.md',
    );
    expect(existsSync(agentPath)).toBe(true);
    const contents = readFileSync(agentPath, 'utf-8');
    expect(contents).toContain('name: product-manager');
  });

  it('creates starter tech-lead agent', async () => {
    await initNightshift(tmpDir);
    const agentPath = join(tmpDir, '.nightshift', 'agents', 'tech-lead.md');
    expect(existsSync(agentPath)).toBe(true);
    const contents = readFileSync(agentPath, 'utf-8');
    expect(contents).toContain('name: tech-lead');
  });

  it('creates starter feature-team with team.toml', async () => {
    await initNightshift(tmpDir);
    const teamPath = join(
      tmpDir,
      '.nightshift',
      'teams',
      'feature-team',
      'team.toml',
    );
    expect(existsSync(teamPath)).toBe(true);
    const contents = readFileSync(teamPath, 'utf-8');
    expect(contents).toContain('name = "feature-team"');
    expect(contents).toContain('lead = "project-lead"');
  });

  it('creates .nightshift/.gitignore that ignores worktrees/', async () => {
    await initNightshift(tmpDir);
    const gitignorePath = join(tmpDir, '.nightshift', '.gitignore');
    expect(existsSync(gitignorePath)).toBe(true);
    const contents = readFileSync(gitignorePath, 'utf-8');
    expect(contents).toContain('worktrees/');
  });

  it('throws if already initialized', async () => {
    await initNightshift(tmpDir);
    await expect(initNightshift(tmpDir)).rejects.toThrow(
      /already initialized/i,
    );
  });
});
