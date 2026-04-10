# Memory

A running log of patterns, preferences, and lessons this team has learned.
Append new entries at the top. Include a date.

---

## 2026-04-10 — Codebase architecture reference

Key files for the agent running harness. Read these before touching anything.

**Execution**
- `src/server/agent-runner.ts` — `runAgent()`: assembles system prompt from agent markdown + team context + chat history, invokes Claude Agent SDK, streams thinking/tool-use back via `onStatus` callback, resumes prior sessions via `sdk_session_id`
- `src/server/team-data.ts` — `runConversationLoop()`: orchestrates multi-agent turns until natural stop; `runConversationJudge()`: Haiku-based LLM judge that decides which agent responds next; @mention parsing; 5-min per-agent timeout; 6-turn max before pausing for human
- `src/server/conversation-timing.spec.md` — canonical spec for judge behaviour; always read before changing routing logic; always update when routing changes

**Persistence**
- `src/db/sessions.ts` — `AgentSession` state machine (idle/working); `upsertSession`, `setSessionSdkId`, `resetStuckSessions` (runs at startup to clear crashes)
- `src/db/messages.ts` — `insertMessage`, `getTeamMessages`, `getProjectMessages`
- `src/db/schema.ts` / `src/db/index.ts` — SQLite schema + WAL-mode connection; DB lives at `~/.nightshift/[project-slug]/nightshift.db`

**CLI**
- `src/cli/commands/agent.ts` — `ns agent create <name>`
- `src/cli/commands/team.ts` — `ns team create <name>`
- `src/cli/commands/project.ts` — project/branch lifecycle

**UI**
- `src/routes/teams/$teamId/-agent-session-view.tsx` — agent session display
- `src/routes/teams/$teamId/agents/$agentName.tsx` — team-scoped session detail
- `src/routes/teams/$teamId/projects/$projectName/agents/$agentName.tsx` — project-scoped session detail

**Testing**
- Tests are co-located with source (e.g. `agent-runner.test.ts` beside `agent-runner.ts`)
- Shared test helpers and tmp filesystem fixtures in `src/cli/test-helpers.ts`
- Coverage threshold: 85% (shadcn UI primitives, generated files, and thin layout shells are excluded — see `coveragePathIgnorePatterns` in `bunfig.toml`)
