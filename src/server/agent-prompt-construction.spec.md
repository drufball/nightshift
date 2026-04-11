# Agent Prompt Construction

This document describes how an agent's system prompt is assembled and how each invocation message is formed.

## Template Selection

The system prompt is built from one of four template files, chosen based on the agent's role (lead or member) and whether the session is in a project context:

| Template file                    | When used                                    |
|----------------------------------|----------------------------------------------|
| `team-lead-prompt.spec.md`       | Lead agent, no project branch                |
| `team-member-prompt.spec.md`     | Non-lead agent, no project branch            |
| `project-lead-prompt.spec.md`    | Lead agent, working on a project branch      |
| `project-member-prompt.spec.md`  | Non-lead agent, working on a project branch  |

`selectPromptTemplate(isLead, projectBranch?)` returns the filename; `loadPromptTemplate(isLead, projectBranch?)` reads it from disk.

## Template Substitution

Each template is the literal system prompt sent to the model, with `${placeholder}` markers filled in at runtime by `buildSystemPrompt`:

| Placeholder        | Value                                                       |
|--------------------|-------------------------------------------------------------|
| `${agentPrompt}`   | Body of `.nightshift/agents/{name}.md` (after frontmatter)  |
| `${teamName}`      | Team name from `team.toml`                                  |
| `${teamFolder}`    | Path to the team directory (`.nightshift/teams/{name}`)     |
| `${projectBranch}` | Current git branch (project templates only)                 |
| `${memberLines}`   | Formatted team roster — `- **name** [(lead)]: description`  |

## Session Start vs. Resumption

The system prompt is only constructed and sent on the **first** invocation for a given agent session. `runAgent` checks for an existing `sdk_session_id`:

- **New session** — the full system prompt is passed to `query` as the `systemPrompt` option
- **Resumed session** — the `resume` option is passed instead; the SDK restores the original system prompt and conversation history automatically, and no system prompt is re-sent

## Invocation Message

Each time an agent is invoked, the caller provides a `userMessage` (the trigger, e.g. a new chat message or @mention). If there are unread chat messages since the agent was last active, they are prepended to the invocation message so the agent has full context:

```
Recent chat:

User: Can you add a login page?
project-lead: On it — @bob can you scaffold the route?

---

<trigger message>
```

The caller is responsible for determining which messages to include:

- **Team lead** — all messages since the last message that either had no @mention or @mentioned the lead
- **Team members** — all messages since the last @mention of that member

When there are no unread messages, the `userMessage` is passed unchanged.
