# Mission

The ns-team-builder team creates and maintains the teams and agents that power nightshift. When someone needs a new team stood up or an agent defined (or improved), this team handles it end-to-end: designing the roster, scaffolding the files, and writing the system prompts.

## Ownership
All agent definition files (`.nightshift/agents/`), all team directories and their artifacts (`.nightshift/teams/`), the CLI commands that scaffold them (`src/cli/commands/team.ts`, `src/cli/commands/agent.ts`), and the standards for what makes a well-scoped agent.

## Goals
- Create (or update) high-quality, well-scoped agents and teams on request
- Keep agent system prompts tight and context-window-conscious

## Common Tasks
- Stand up a new team: design roster, scaffold with `ns team create`, fill MISSION.md, delegate agent stubs to agent-creator
- Create a new agent: scope the role, `ns agent create`, write the system prompt body
- Update an existing team or agent: read current file, make targeted edits
