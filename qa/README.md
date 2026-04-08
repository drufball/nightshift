# QA Fixture

Disposable test environment for nightshift manual testing.

## Quick start

```bash
# 1. Create the fixture (idempotent)
bun qa/fixture.ts

# 2. Serve it on port 3001 (avoids conflict with a local dev server on 3000)
cd /tmp/nightshift-qa-fixture && ns serve --port 3001

# 3. Open the app
# http://localhost:3001
```

To reset to a clean state:

```bash
bun qa/fixture.ts --reset
```

## What the fixture creates

**`feature-team`** (home team — app opens here)
- Agents: project-lead (lead), product-manager, tech-lead
- Team chat: 6-message auth feature discussion
- Projects: `auth-backend` (3 messages, tech-lead working), `auth-ui` (empty)

**`ops-team`**
- Agents: devops-lead (lead), sre
- Team chat: 4-message k8s migration discussion
- Projects: `k8s-migration` (empty)

## Product flows

Manual test flows live in `product-flows/`.

## Running with playwright-cli

```
Use the playwright-cli skill to test nightshift at http://localhost:3001.
Follow product-flows/01-team-chat-and-mentions.md step by step.
```
