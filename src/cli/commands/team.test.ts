import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { createTmpDir, removeTmpDir } from '../test-helpers';
import { initNightshift } from './init';
import { createTeam, registerTeam } from './team';

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

  it('throws if lead name contains invalid characters', async () => {
    await expect(
      createTeam(tmpDir, 'my-team', 'Bad Lead!', []),
    ).rejects.toThrow(/invalid.*name/i);
  });

  it('throws if a member name contains invalid characters', async () => {
    await expect(
      createTeam(tmpDir, 'my-team', 'project-lead', ['Bad Member!']),
    ).rejects.toThrow(/invalid.*name/i);
  });

  it('creates MISSION.md in the team directory', async () => {
    await createTeam(tmpDir, 'my-team', 'project-lead', []);
    expect(
      existsSync(join(tmpDir, '.nightshift', 'teams', 'my-team', 'MISSION.md')),
    ).toBe(true);
  });

  it('MISSION.md contains ownership and goals sections', async () => {
    await createTeam(tmpDir, 'my-team', 'project-lead', []);
    const contents = readFileSync(
      join(tmpDir, '.nightshift', 'teams', 'my-team', 'MISSION.md'),
      'utf-8',
    );
    expect(contents).toContain('## Ownership');
    expect(contents).toContain('## Goals');
  });

  it('creates MEMORY.md in the team directory', async () => {
    await createTeam(tmpDir, 'my-team', 'project-lead', []);
    expect(
      existsSync(join(tmpDir, '.nightshift', 'teams', 'my-team', 'MEMORY.md')),
    ).toBe(true);
  });

  it('MEMORY.md contains instructions for appending entries', async () => {
    await createTeam(tmpDir, 'my-team', 'project-lead', []);
    const contents = readFileSync(
      join(tmpDir, '.nightshift', 'teams', 'my-team', 'MEMORY.md'),
      'utf-8',
    );
    expect(contents).toContain('Append');
  });

  it('creates DECISIONS.md in the team directory', async () => {
    await createTeam(tmpDir, 'my-team', 'project-lead', []);
    expect(
      existsSync(
        join(tmpDir, '.nightshift', 'teams', 'my-team', 'DECISIONS.md'),
      ),
    ).toBe(true);
  });

  it('DECISIONS.md contains a table header', async () => {
    await createTeam(tmpDir, 'my-team', 'project-lead', []);
    const contents = readFileSync(
      join(tmpDir, '.nightshift', 'teams', 'my-team', 'DECISIONS.md'),
      'utf-8',
    );
    expect(contents).toContain('| Date |');
  });
});

describe('registerTeam', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    await initNightshift(tmpDir);
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it('registers a "team create" subcommand on the program', () => {
    const program = new Command();
    program.exitOverride();
    registerTeam(program);
    const teamCmd = program.commands.find((c) => c.name() === 'team');
    expect(teamCmd).toBeDefined();
    const createCmd = teamCmd?.commands.find((c) => c.name() === 'create');
    expect(createCmd).toBeDefined();
  });

  it('team create action calls process.exit(1) on invalid name', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation(
      (_code?: number) => undefined as never,
    );
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    const program = new Command();
    program.exitOverride();
    registerTeam(program);
    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    try {
      await program.parseAsync(
        ['team', 'create', 'Bad Name!', '--lead', 'project-lead'],
        { from: 'user' },
      );
    } catch {
      // commander exitOverride may throw on parse errors
    }
    process.cwd = origCwd;
    // Check before mockRestore — Bun clears mock.calls on restore
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('team create action logs success and creates team directory', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command();
    program.exitOverride();
    registerTeam(program);
    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    try {
      await program.parseAsync(
        ['team', 'create', 'my-team', '--lead', 'project-lead'],
        { from: 'user' },
      );
    } catch {
      // no-op
    }
    process.cwd = origCwd;
    // Check before mockRestore — Bun clears mock.calls on restore
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('my-team'));
    logSpy.mockRestore();
    expect(
      existsSync(join(tmpDir, '.nightshift', 'teams', 'my-team', 'team.toml')),
    ).toBe(true);
  });
});
