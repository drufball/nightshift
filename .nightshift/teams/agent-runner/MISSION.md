# Mission

The agent-runner team owns the harness that brings nightshift agents to life — the execution engine, conversation loop, session state, and persistence layer that turn markdown agent definitions into live, coordinated multi-agent conversations. This team exists to keep that machinery reliable, observable, and easy to extend as the platform evolves.

## Ownership

**Code areas**
- `src/server/agent-runner.ts` — core agent execution via Claude Agent SDK (`runAgent`, tool allowlist, streaming callbacks, session resumption)
- `src/server/team-data.ts` — multi-agent conversation orchestration (`runConversationLoop`, `runConversationJudge`, @mention routing, turn limits, timeouts)
- `src/server/conversation-timing.spec.md` — judge behaviour specification
- `src/db/sessions.ts` — agent session state machine (idle/working, `sdk_session_id`, stuck-session reset)
- `src/db/messages.ts` — message persistence (`insertMessage`, `getTeamMessages`, `getProjectMessages`)
- `src/db/schema.ts` + `src/db/index.ts` — SQLite schema and WAL-mode connection
- `src/cli/commands/agent.ts`, `team.ts`, `project.ts` — CLI commands for managing agents, teams, and projects
- `src/routes/teams/$teamId/-agent-session-view.tsx` and related agent session UI routes

**System prompt quality and updates**
- Core harness prompts live as `<harness-name>.spec.md` files with `${}` template syntax; this team owns those files and the inflation code
- Quality tuning: adjusting guardrails, orient steps, tool guidance, and context injection in the base prompts that run every agent

## Goals

- High-quality agent output
- Improve agent capabilities
- Provide users visibility and control over agent actions
- Ensure agents have all the context they need, without bloating context windows or requiring user intervention

## Common Tasks

- **Debug a stuck or hung agent** — inspect `sessions` table, check `resetStuckSessions`, trace the 5-minute timeout in `runConversationLoop`
- **Add a new tool to the runner allowlist** — edit tool list in `agent-runner.ts`, write a test, update docs
- **Tune conversation routing** — modify `runConversationJudge` prompt or fall-through logic in `team-data.ts`; update `conversation-timing.spec.md` to match
- **Update a core harness system prompt** — edit the relevant `.spec.md` first, then update inflation code in `buildSystemPrompt`
- **Add or alter a DB column** — update `schema.ts`, write a migration, update affected query helpers
- **Add a CLI subcommand** — scaffold in `src/cli/commands/`, wire into `src/cli/index.ts`, co-locate tests
- **Fix a session resumption bug** — trace `sdk_session_id` flow from `setSessionSdkId` through `runAgent`
- **Schema migrations** — any DB schema change goes through this team
- **Session lifecycle changes** — startup reset of stuck sessions, session resumption policy
