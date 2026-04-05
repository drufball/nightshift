# Agent System Prompt Construction

This document specifies how system prompts are assembled for each agent invocation in nightshift.

## 1. Base Agent Prompt

Each agent is defined by a Markdown file at `.nightshift/agents/{name}.md`:

```
---
name: agent-name
description: One-line description of the agent's role.
---

The agent's core personality and instructions go here.
```

The **base prompt** is the content after the `---` frontmatter delimiter, trimmed of whitespace.

## 2. Team Context Section

After the base prompt, a section describing the full team is appended:

```
---

## Your Team

Team: **feature-team**
Team folder: `.nightshift/teams/feature-team`
Current project branch: `feature/login-page`   ← only present when working in a project

Members — use @name to mention a teammate and ensure they respond next:

- **project-lead** (lead): Coordinates the team, delegates tasks, and communicates with stakeholders.
- **product-manager**: Defines requirements and ensures work aligns with user needs.
- **tech-lead**: Breaks down requirements into tasks and leads implementation.

Mention `@user` when you need input from the human user before continuing.
```

Fields included:
- **Team name**: the team's name as defined in `team.toml`
- **Team folder**: the path to the team's folder (`.nightshift/teams/{name}`) where team-specific files live
- **Current project branch**: only present when the agent is running in the context of a project; gives the git branch to work on
- **Members**: all team members with their descriptions; the lead is marked "(lead)"

## @Mention Convention

Agents communicate by @mentioning teammates:

- `@tech-lead` — the tech-lead will be invoked to respond in the next turn
- `@user` — signals that the conversation needs human input before continuing; no further agents will be invoked

Agents messages should always make it obvious who should respond to their message and what input they need. If they are completing someone else's request and don't need a response, that should be obvious.

## 3. Recent Team Chat Section

Finally, recent team messages are appended as context:

```
---

## Recent Team Chat

The following messages were recently posted in the team chat. Use this as context for your work:

User: Can you add a login page?
project-lead: Sure, let me coordinate the team.
```

Up to the last 20 messages are included. Messages are formatted as `{sender}: {content}`, with user messages labeled `User`.

## Session Resumption

If an agent already has an active SDK session (`agent_sessions.sdk_session_id` is set), the session is **resumed** rather than started fresh:

- The full system prompt is **not** re-sent (the SDK preserves it from the original session)
- The new message is appended to the existing conversation as a new user turn
- This preserves the agent's full conversation history and context across multiple user messages

The system prompt (steps 1–3 above) is only constructed and sent on the **first** invocation for a given agent + team combination.
