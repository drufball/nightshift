import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { createTmpDir, removeTmpDir } from '../test-helpers';
import { createAgent, registerAgent } from './agent';
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

describe('registerAgent', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    await initNightshift(tmpDir);
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it('registers an "agent create" subcommand on the program', () => {
    const program = new Command();
    program.exitOverride();
    registerAgent(program);
    const agentCmd = program.commands.find((c) => c.name() === 'agent');
    expect(agentCmd).toBeDefined();
    const createCmd = agentCmd?.commands.find((c) => c.name() === 'create');
    expect(createCmd).toBeDefined();
  });

  it('agent create action calls process.exit(1) on invalid name', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation(
      (_code?: number) => undefined as never,
    );
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    const program = new Command();
    program.exitOverride();
    registerAgent(program);
    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    try {
      await program.parseAsync(['agent', 'create', 'Bad Name!'], {
        from: 'user',
      });
    } catch {
      // commander exitOverride may throw on parse errors
    }
    process.cwd = origCwd;
    // Check before mockRestore — Bun clears mock.calls on restore
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('agent create action logs success and creates file', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command();
    program.exitOverride();
    registerAgent(program);
    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    try {
      await program.parseAsync(['agent', 'create', 'my-agent'], {
        from: 'user',
      });
    } catch {
      // no-op
    }
    process.cwd = origCwd;
    // Check before mockRestore — Bun clears mock.calls on restore
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('my-agent'));
    logSpy.mockRestore();
    expect(
      existsSync(join(tmpDir, '.nightshift', 'agents', 'my-agent.md')),
    ).toBe(true);
  });
});
