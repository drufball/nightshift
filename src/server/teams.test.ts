import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTmpDir, removeTmpDir } from '~/cli/test-helpers';
import { readTeams } from './teams';

describe('readTeams', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it('returns empty array when .nightshift/teams does not exist', async () => {
    const teams = await readTeams(tmpDir);
    expect(teams).toEqual([]);
  });

  it('returns parsed teams sorted alphabetically', async () => {
    const teamsDir = join(tmpDir, '.nightshift', 'teams');
    await mkdir(join(teamsDir, 'zebra-team'), { recursive: true });
    await mkdir(join(teamsDir, 'alpha-team'), { recursive: true });

    await writeFile(
      join(teamsDir, 'zebra-team', 'team.toml'),
      `name = "zebra-team"\nlead = "project-lead"\nmembers = ["tech-lead"]`,
    );
    await writeFile(
      join(teamsDir, 'alpha-team', 'team.toml'),
      `name = "alpha-team"\nlead = "product-manager"\nmembers = []`,
    );

    const teams = await readTeams(tmpDir);
    expect(teams).toHaveLength(2);
    expect(teams[0].name).toBe('alpha-team');
    expect(teams[1].name).toBe('zebra-team');
    expect(teams[0].lead).toBe('product-manager');
    expect(teams[1].members).toEqual(['tech-lead']);
  });

  it('skips entries without a valid team.toml', async () => {
    const teamsDir = join(tmpDir, '.nightshift', 'teams');
    await mkdir(join(teamsDir, 'broken-team'), { recursive: true });
    // no team.toml written

    const teams = await readTeams(tmpDir);
    expect(teams).toHaveLength(0);
  });
});
