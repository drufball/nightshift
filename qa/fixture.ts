#!/usr/bin/env bun
/**
 * QA fixture for nightshift manual testing.
 *
 * Creates an isolated git repo at /tmp/nightshift-qa-fixture/ with nightshift
 * initialized and the DB seeded with realistic test data:
 *
 *   feature-team  — 3 agents, 6 team-level messages, 2 open projects,
 *                   auth-backend has 3 project messages
 *   ops-team      — 2 agents, 4 team-level messages, 1 open project
 *
 * Usage:
 *   bun qa/fixture.ts           # set up (skips if already exists)
 *   bun qa/fixture.ts --reset   # tear down and recreate from scratch
 *
 * After running, serve the fixture:
 *   cd /tmp/nightshift-qa-fixture && ns serve --port 3001
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db/index';

// ── Config ────────────────────────────────────────────────────────────────────

const FIXTURE_DIR = '/tmp/nightshift-qa-fixture';
const DB_PATH = join(
  homedir(),
  '.nightshift',
  'nightshift-qa-fixture',
  'nightshift.db',
);

// ── CLI args ──────────────────────────────────────────────────────────────────

const reset = process.argv.includes('--reset');

// ── Helpers ───────────────────────────────────────────────────────────────────

function git(args: string[], cwd: string) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function write(path: string, content: string) {
  mkdirSync(path.substring(0, path.lastIndexOf('/')), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function insertMessages(
  teamId: string,
  rows: [sender: string, content: string, mentions: string[], ts: number][],
  projectId?: string,
) {
  for (const [sender, content, mentions, ts] of rows) {
    db.run(
      'INSERT INTO messages (id, team_id, project_id, sender, content, mentions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        randomUUID(),
        teamId,
        projectId ?? null,
        sender,
        content,
        JSON.stringify(mentions),
        ts,
      ],
    );
  }
}

function insertSession(
  teamId: string,
  agentName: string,
  status: 'idle' | 'working',
  statusText: string | null,
  ts: number,
  projectId?: string,
) {
  db.run(
    'INSERT INTO agent_sessions (id, team_id, project_id, agent_name, status, status_text, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      randomUUID(),
      teamId,
      projectId ?? null,
      agentName,
      status,
      statusText,
      ts,
    ],
  );
}

// ── Teardown / early exit ─────────────────────────────────────────────────────

if (reset && existsSync(FIXTURE_DIR)) {
  console.log('Removing existing fixture...');
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  rmSync(DB_PATH, { force: true });
} else if (existsSync(FIXTURE_DIR)) {
  console.log(`Fixture already exists at ${FIXTURE_DIR}`);
  console.log('Run with --reset to recreate.');
  printServeCommand();
  process.exit(0);
}

// ── Git repo ──────────────────────────────────────────────────────────────────

console.log(`Creating fixture repo at ${FIXTURE_DIR}...`);
mkdirSync(FIXTURE_DIR, { recursive: true });
git(['init'], FIXTURE_DIR);
git(['config', 'user.email', 'qa@nightshift.local'], FIXTURE_DIR);
git(['config', 'user.name', 'QA Fixture'], FIXTURE_DIR);

write(
  join(FIXTURE_DIR, 'README.md'),
  '# nightshift-qa-fixture\n\nDisposable repo for manual QA testing.\n',
);
git(['add', 'README.md'], FIXTURE_DIR);
git(['commit', '-m', 'chore: initial commit'], FIXTURE_DIR);

// ── .nightshift structure ─────────────────────────────────────────────────────

write(
  join(FIXTURE_DIR, 'nightshift.toml'),
  `[diff]
ignore = [
  "**/*.test.ts",
  "**/*.spec.ts",
  "bun.lock",
]

[team]
home = "feature-team"
`,
);

write(join(FIXTURE_DIR, '.nightshift', '.gitignore'), 'worktrees/\n');
mkdirSync(join(FIXTURE_DIR, '.nightshift', 'worktrees'), { recursive: true });

write(
  join(FIXTURE_DIR, '.nightshift', 'agents', 'project-lead.md'),
  `---
name: project-lead
description: Coordinates the team, delegates tasks, and communicates with stakeholders.
---

You are the project lead for this team. You coordinate work across team members
and communicate progress back to the user.
`,
);

write(
  join(FIXTURE_DIR, '.nightshift', 'agents', 'product-manager.md'),
  `---
name: product-manager
description: Defines requirements and ensures work aligns with user needs.
---

You are the product manager for this team. You translate user needs into clear
requirements for the engineering team.
`,
);

write(
  join(FIXTURE_DIR, '.nightshift', 'agents', 'tech-lead.md'),
  `---
name: tech-lead
description: Breaks down requirements into tasks and leads implementation.
---

You are the tech lead for this project. You translate product requirements into
a concrete implementation plan and write the code to execute it.
`,
);

write(
  join(FIXTURE_DIR, '.nightshift', 'agents', 'devops-lead.md'),
  `---
name: devops-lead
description: Owns infrastructure, CI/CD pipelines, and deployment strategy.
---

You are the devops lead. You are responsible for infrastructure, deployments,
and keeping the platform reliable.
`,
);

write(
  join(FIXTURE_DIR, '.nightshift', 'agents', 'sre.md'),
  `---
name: sre
description: Site reliability engineer — monitors uptime, incidents, and SLOs.
---

You are the site reliability engineer. You monitor production systems, respond
to incidents, and work to improve reliability over time.
`,
);

write(
  join(FIXTURE_DIR, '.nightshift', 'teams', 'feature-team', 'team.toml'),
  `name = "feature-team"
lead = "project-lead"
members = ["product-manager", "tech-lead"]
`,
);

write(
  join(FIXTURE_DIR, '.nightshift', 'teams', 'ops-team', 'team.toml'),
  `name = "ops-team"
lead = "devops-lead"
members = ["sre"]
`,
);

// ── Database ──────────────────────────────────────────────────────────────────

const db = openDb(DB_PATH);

const now = Date.now();
const min = 60_000;

// ── feature-team ──────────────────────────────────────────────────────────────

const FEATURE_TEAM = 'feature-team';
const projectAuthBackendId = randomUUID();
const projectAuthUiId = randomUUID();

db.run(
  'INSERT INTO projects (id, name, team_id, branch, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  [
    projectAuthBackendId,
    'auth-backend',
    FEATURE_TEAM,
    'ns/auth-backend',
    'open',
    now - 45 * min,
  ],
);
db.run(
  'INSERT INTO projects (id, name, team_id, branch, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  [
    projectAuthUiId,
    'auth-ui',
    FEATURE_TEAM,
    'ns/auth-ui',
    'open',
    now - 30 * min,
  ],
);

insertMessages(FEATURE_TEAM, [
  [
    'user',
    'We need to add user authentication to the dashboard. @project-lead can you scope this out?',
    ['project-lead'],
    now - 60 * min,
  ],
  [
    'project-lead',
    "@product-manager please define the auth requirements — what flows we need and any compliance constraints. @tech-lead once we have requirements I'll need your estimate on the backend work.",
    ['product-manager', 'tech-lead'],
    now - 59 * min,
  ],
  [
    'product-manager',
    `Here are the requirements for user authentication:

**Flows needed:**
1. Sign up (email + password)
2. Sign in / sign out
3. Password reset via email

**Constraints:**
- Passwords must be hashed (bcrypt, min 12 rounds)
- Sessions expire after 30 days inactive
- No third-party OAuth in v1

@tech-lead this should be enough to estimate.`,
    ['tech-lead'],
    now - 55 * min,
  ],
  [
    'tech-lead',
    `Thanks @product-manager. Breakdown:

**Backend (auth-backend project):**
- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/logout
- POST /api/auth/reset-password

Estimated 2–3 days. I've opened the auth-backend project and started on the user model. @user let me know when you want me to proceed with the UI side too.`,
    ['user'],
    now - 50 * min,
  ],
  [
    'user',
    'Good. Start on backend. @project-lead please coordinate.',
    ['project-lead'],
    now - 40 * min,
  ],
  [
    'project-lead',
    "@tech-lead you're up. Start with register and login endpoints. I'll check in once they're working. @user I'll update you at the first milestone.",
    ['tech-lead', 'user'],
    now - 39 * min,
  ],
]);

insertMessages(
  FEATURE_TEAM,
  [
    [
      'user',
      'Implement the JWT auth endpoints. Start with register and login.',
      [],
      now - 38 * min,
    ],
    [
      'tech-lead',
      `Reading the codebase now to understand the existing structure.

Found: Express + TypeScript, no auth middleware yet. I'll add:
- src/routes/auth.ts — endpoint handlers
- src/middleware/auth.ts — JWT verification
- src/models/user.ts — user schema + password helpers

Starting with the user model.`,
      [],
      now - 36 * min,
    ],
    [
      'tech-lead',
      `User model done:

\`\`\`typescript
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
\`\`\`

Moving on to the register endpoint. @user I'll have a working draft shortly.`,
      ['user'],
      now - 30 * min,
    ],
  ],
  projectAuthBackendId,
);

insertSession(FEATURE_TEAM, 'project-lead', 'idle', null, now - 39 * min);
insertSession(
  FEATURE_TEAM,
  'product-manager',
  'idle',
  'Requirements complete',
  now - 55 * min,
);
insertSession(
  FEATURE_TEAM,
  'tech-lead',
  'working',
  'Writing register endpoint...',
  now - 2 * min,
  projectAuthBackendId,
);

// ── ops-team ──────────────────────────────────────────────────────────────────

const OPS_TEAM = 'ops-team';
const projectInfraId = randomUUID();

db.run(
  'INSERT INTO projects (id, name, team_id, branch, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  [
    projectInfraId,
    'k8s-migration',
    OPS_TEAM,
    'ns/k8s-migration',
    'open',
    now - 120 * min,
  ],
);

insertMessages(OPS_TEAM, [
  [
    'user',
    'We need to migrate the staging environment from docker-compose to Kubernetes. @devops-lead can you plan this out?',
    ['devops-lead'],
    now - 90 * min,
  ],
  [
    'devops-lead',
    '@sre can you audit the current docker-compose setup and flag anything that needs special handling in k8s — volumes, secrets, networking?',
    ['sre'],
    now - 88 * min,
  ],
  [
    'sre',
    `Audited the current setup. Key things to handle:

- 3 persistent volumes (postgres data, redis data, upload storage)
- 2 secrets currently in .env files — need to move to k8s Secrets
- Internal service-to-service calls use docker hostnames — need ClusterIP Services
- Health checks defined in compose but not standardised — should add /healthz endpoints

@devops-lead I'd suggest tackling secrets first, then services, then volumes. I've opened the k8s-migration project.`,
    ['devops-lead'],
    now - 85 * min,
  ],
  [
    'devops-lead',
    "Good audit. @user I'll start with secrets management and have a plan in the k8s-migration project shortly.",
    ['user'],
    now - 80 * min,
  ],
]);

insertSession(OPS_TEAM, 'devops-lead', 'idle', null, now - 80 * min);
insertSession(OPS_TEAM, 'sre', 'idle', 'Audit complete', now - 85 * min);

db.close();

// ── Done ──────────────────────────────────────────────────────────────────────

console.log('');
console.log('Fixture ready:');
console.log('  feature-team — project-lead, product-manager, tech-lead');
console.log('                 projects: auth-backend (with history), auth-ui');
console.log('  ops-team     — devops-lead, sre');
console.log('                 projects: k8s-migration');
console.log('');
printServeCommand();

function printServeCommand() {
  console.log('To start the server:');
  console.log('');
  console.log(`  cd ${FIXTURE_DIR} && ns serve --port 3001`);
  console.log('');
  console.log('Then open: http://localhost:3001');
  console.log('');
  console.log('Flows to test: product-flows/');
}
