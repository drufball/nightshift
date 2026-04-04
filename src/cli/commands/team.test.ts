import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTmpDir, removeTmpDir } from '../test-helpers';
import { initNightshift } from './init';
import { createTeam } from './team';

describe('createTeam', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    await initNightshift(tmpDir);
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it('creates team directory under .nightshift/teams/', async () => {
    await createTeam(tmpDir, 'my-team', 'project-lead', []);
    expect(existsSync(join(tmpDir, '.nightshift', 'teams', 'my-team'))).toBe(
      true,
    );
  });

  it('creates team.toml in the team directory', async () => {
    await createTeam(tmpDir, 'my-team', 'project-lead', []);
    expect(
      existsSync(join(tmpDir, '.nightshift', 'teams', 'my-team', 'team.toml')),
    ).toBe(true);
  });

  it('team.toml contains name', async () => {
    await createTeam(tmpDir, 'my-team', 'project-lead', []);
    const contents = readFileSync(
      join(tmpDir, '.nightshift', 'teams', 'my-team', 'team.toml'),
      'utf-8',
    );
    expect(contents).toContain('name = "my-team"');
  });

  it('team.toml contains lead', async () => {
    await createTeam(tmpDir, 'my-team', 'project-lead', []);
    const contents = readFileSync(
      join(tmpDir, '.nightshift', 'teams', 'my-team', 'team.toml'),
      'utf-8',
    );
    expect(contents).toContain('lead = "project-lead"');
  });

  it('team.toml contains members array', async () => {
    await createTeam(tmpDir, 'my-team', 'project-lead', [
      'tech-lead',
      'product-manager',
    ]);
    const contents = readFileSync(
      join(tmpDir, '.nightshift', 'teams', 'my-team', 'team.toml'),
      'utf-8',
    );
    expect(contents).toContain('"tech-lead"');
    expect(contents).toContain('"product-manager"');
  });

  it('team.toml has empty members array when none provided', async () => {
    await createTeam(tmpDir, 'my-team', 'project-lead', []);
    const contents = readFileSync(
      join(tmpDir, '.nightshift', 'teams', 'my-team', 'team.toml'),
      'utf-8',
    );
    expect(contents).toContain('members = []');
  });

  it('throws if .nightshift does not exist', async () => {
    const uninitDir = await createTmpDir();
    try {
      await expect(
        createTeam(uninitDir, 'my-team', 'project-lead', []),
      ).rejects.toThrow(/not initialized/i);
    } finally {
      await removeTmpDir(uninitDir);
    }
  });

  it('throws if team already exists', async () => {
    await createTeam(tmpDir, 'my-team', 'project-lead', []);
    await expect(
      createTeam(tmpDir, 'my-team', 'project-lead', []),
    ).rejects.toThrow(/already exists/i);
  });

  it('throws if team name contains invalid characters', async () => {
    await expect(
      createTeam(tmpDir, 'My Team!', 'project-lead', []),
    ).rejects.toThrow(/invalid.*name/i);
  });
});
