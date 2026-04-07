import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTmpDir, removeTmpDir } from '~/cli/test-helpers';
import { readHomeTeam, readTeams, resolveStartTeam } from './teams';

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

describe('readHomeTeam', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it('returns null when nightshift.toml does not exist', async () => {
    expect(await readHomeTeam(tmpDir)).toBeNull();
  });

  it('returns null when [team] section is missing', async () => {
    await writeFile(join(tmpDir, 'nightshift.toml'), '[diff]\nignore = []\n');
    expect(await readHomeTeam(tmpDir)).toBeNull();
  });

  it('returns null when home is not set under [team]', async () => {
    await writeFile(join(tmpDir, 'nightshift.toml'), '[team]\n');
    expect(await readHomeTeam(tmpDir)).toBeNull();
  });

  it('reads home team name from [team] section', async () => {
    await writeFile(
      join(tmpDir, 'nightshift.toml'),
      '[diff]\nignore = []\n\n[team]\nhome = "my-team"\n',
    );
    expect(await readHomeTeam(tmpDir)).toBe('my-team');
  });

  it('returns home team even when [team] section comes first', async () => {
    await writeFile(
      join(tmpDir, 'nightshift.toml'),
      '[team]\nhome = "alpha-team"\n\n[diff]\nignore = []\n',
    );
    expect(await readHomeTeam(tmpDir)).toBe('alpha-team');
  });
});

describe('resolveStartTeam', () => {
  const alpha = { name: 'alpha-team', lead: '', members: [] };
  const beta = { name: 'beta-team', lead: '', members: [] };
  const teams = [alpha, beta];

  it('returns home team when set and present in list', () => {
    expect(resolveStartTeam('beta-team', teams)).toBe('beta-team');
  });

  it('returns first team alphabetically when home team is null', () => {
    expect(resolveStartTeam(null, teams)).toBe('alpha-team');
  });

  it('returns first team alphabetically when home team is not found', () => {
    expect(resolveStartTeam('missing-team', teams)).toBe('alpha-team');
  });

  it('returns null when teams list is empty', () => {
    expect(resolveStartTeam(null, [])).toBeNull();
  });

  it('returns null when home team not found and teams list is empty', () => {
    expect(resolveStartTeam('some-team', [])).toBeNull();
  });
});
