import { createServerFn } from '@tanstack/react-start';

export interface TeamMeta {
  name: string;
  lead: string;
  members: string[];
}

/** Lead first, then remaining members in declaration order, no duplicates. */
export function orderedMembers(team: TeamMeta): string[] {
  return [team.lead, ...team.members.filter((m) => m !== team.lead)];
}

function parseTeamToml(content: string): TeamMeta {
  const name = content.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? '';
  const lead = content.match(/^lead\s*=\s*"([^"]+)"/m)?.[1] ?? '';
  const membersMatch = content.match(/^members\s*=\s*\[([^\]]*)\]/m)?.[1] ?? '';
  const members = membersMatch
    ? membersMatch
        .split(',')
        .map((s) => s.trim().replace(/^"|"$/g, ''))
        .filter(Boolean)
    : [];
  return { name, lead, members };
}

export async function readTeams(cwd: string): Promise<TeamMeta[]> {
  const { readFile, readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const teamsDir = join(cwd, '.nightshift', 'teams');
  let entries: string[];
  try {
    entries = await readdir(teamsDir);
  } catch {
    return [];
  }

  const teams: TeamMeta[] = [];
  for (const entry of entries.sort()) {
    try {
      const content = await readFile(
        join(teamsDir, entry, 'team.toml'),
        'utf8',
      );
      teams.push(parseTeamToml(content));
    } catch {
      // skip malformed entries
    }
  }
  return teams;
}

export async function resolveCwd(): Promise<string> {
  if (process.env.NIGHTSHIFT_PROJECT_DIR) {
    return process.env.NIGHTSHIFT_PROJECT_DIR;
  }
  const { execFileSync } = await import('node:child_process');
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    stdio: 'pipe',
  })
    .toString()
    .trim();
}

export const listTeams = createServerFn({ method: 'GET' }).handler(async () =>
  readTeams(await resolveCwd()),
);

export const createTeam = createServerFn({ method: 'POST' })
  .inputValidator((data: { name: string }) => data)
  .handler(async ({ data }) => {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const cwd = await resolveCwd();
    const teamDir = join(cwd, '.nightshift', 'teams', data.name);
    await mkdir(teamDir, { recursive: true });
    const toml = `name = "${data.name}"\nlead = ""\nmembers = []\n`;
    await writeFile(join(teamDir, 'team.toml'), toml, 'utf8');
    return { name: data.name, lead: '', members: [] } satisfies TeamMeta;
  });
