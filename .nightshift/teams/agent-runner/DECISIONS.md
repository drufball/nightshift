# Decisions

Key decisions made by this team. Record decisions here so agents and humans
don't re-litigate them.

| Date | Decision | Rationale | Status |
|------|----------|-----------|--------|
| 2026-04-10 | SQLite with WAL mode as the persistence layer | Single-file DB is sufficient for local-first usage; WAL mode allows concurrent reads without blocking writes | Active |
| 2026-04-11 | Deterministic routing replaces LLM judge | Predictable behaviour, no extra API call per turn, no hallucination risk; lead acts as orchestrator and is the default handler for user and member messages | Active |
| 2026-04-10 | 5-minute timeout per agent turn | Guards against hung SDK streams without killing short-lived tasks | Active |
| 2026-04-10 | Session resumption via `sdk_session_id` stored in DB | Allows agents to continue multi-turn conversations across restarts | Active |
| 2026-04-10 | `resetStuckSessions` runs at server startup | Cleans up sessions left in `working` state from crashes; safer than trying to resume unknown state | Active |
| 2026-04-10 | Agent definitions are plain markdown files with YAML frontmatter | Low barrier to create/edit agents; no DSL to learn | Active |
| 2026-04-10 | Tool allowlist in runner (not per-agent) | Centralises capability control; agents don't grant themselves tools | Active |
