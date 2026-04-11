# Agent System Prompt Construction

System prompts are assembled by loading a spec template file and substituting
dynamic data via `${placeholder}` syntax. There are four templates — one for
each combination of role (lead / member) and context (team / project):

| Template file                  | When used                                     |
|-------------------------------|-----------------------------------------------|
| `team-lead-prompt.spec.md`    | Lead agent, no project branch                 |
| `team-member-prompt.spec.md`  | Non-lead agent, no project branch             |
| `project-lead-prompt.spec.md` | Lead agent, working on a project branch       |
| `project-member-prompt.spec.md` | Non-lead agent, working on a project branch |

Each template is the literal system prompt sent to the model, with the
following placeholders filled in at runtime:

| Placeholder        | Value                                                         |
|--------------------|---------------------------------------------------------------|
| `${agentPrompt}`   | Body of `.nightshift/agents/{name}.md` (after frontmatter)    |
| `${teamName}`      | Team name from `team.toml`                                    |
| `${teamFolder}`    | Path to the team directory (`.nightshift/teams/{name}`)       |
| `${projectBranch}` | Current git branch (project templates only)                   |
| `${memberLines}`   | Formatted team roster — `- **name** [(lead)]: description`    |
| `${chatSection}`   | Formatted chat messages, or empty string if no messages       |

## Recent Chat Section

Each template owns its own section heading (`## Recent Team Chat` or
`## Recent Project Chat`). `${chatSection}` only contains the formatted
message lines:

```
User: Can you add a login page?
project-lead: Sure, let me coordinate the team.
```

When `chatContext` is empty, `${chatSection}` is an empty string — the
heading is still present in the template but no messages follow it.

Up to the last 20 messages are included. Messages are formatted as
`{sender}: {content}`, with user messages labeled `User`.

## Session Resumption

If an agent already has an active SDK session (`agent_sessions.sdk_session_id`
is set), the session is **resumed** rather than started fresh:

- The full system prompt is **not** re-sent (the SDK preserves it from the original session)
- The new message is appended to the existing conversation as a new user turn
- This preserves the agent's full conversation history and context across multiple user messages

The system prompt is only constructed and sent on the **first** invocation for
a given agent + team combination.
