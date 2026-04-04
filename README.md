# nightshift

Define a team of AI agents and let them do the work.

You describe what you want. Your team lead coordinates with the other members, delegates tasks, and works through the implementation. When you come back, there's a diff to review. Leave comments, send them back to iterate. Merge when happy.

---

## Concepts

**Agents** are AI personas defined by a markdown file. The file is their system prompt — give them a name, a role, and whatever context makes them effective. Agents are reusable across teams.

**Teams** are long-lived working contexts. A team has a lead agent (who you primarily talk to), a set of members, and a shared directory where they maintain their own files, notes, and memory between sessions.

**Projects** are individual efforts on a branch. When your team has changes to make, they work within a project — an isolated git worktree scoped to that branch. Agents work sequentially within the same worktree to minimise coordination confusion: the lead has full context of every change before directing the next member. When a project is merged, the worktree is cleaned up.

---

## Getting started

### Init

```
nightshift init
```

Creates the initial structure:

```
nightshift.toml
.nightshift/
  .gitignore            # ignores worktrees/
  agents/               # starter agents, customise to your needs
    project-lead.md
    product-manager.md
    tech-lead.md
  teams/                # starter team, customise to your needs
    feature-team/
      team.toml
  worktrees/            # created at runtime, gitignored
```

### Agents

```
nightshift agent create <name>
nightshift agent create <name> --description "Owns the data pipeline"
```

Creates `.nightshift/agents/<name>.md`. The file is the agent's full system prompt — edit it directly to define their role, knowledge, and behavior.

Example `.nightshift/agents/tech-lead.md`:

```markdown
---
name: tech-lead
description: Breaks down requirements into tasks and leads implementation.
---

You are the tech lead for this project. You have deep familiarity with the
codebase and are responsible for translating product requirements into a
concrete implementation plan and writing the code to execute it.

When given a task, start by reading the relevant files to understand the
current state before making any changes.
```

### Teams

```
nightshift team create <name> --lead <agent> --member <agent> --member <agent>
```

Creates `.nightshift/teams/<name>/` with a `team.toml` at the root. The directory is the team's working space — agents can read and write files here to maintain context across sessions.

Example `.nightshift/teams/feature-team/team.toml`:

```toml
name = "feature-team"
lead = "project-lead"
members = ["product-manager", "tech-lead"]
```

### Projects

```
nightshift project create <name> --team <team>
nightshift project merge <name>
```

`create` opens a new branch and worktree at `.nightshift/worktrees/<name>`. `merge` merges the branch into main and removes the worktree.

### nightshift.toml

Repository-level config. The `diff.ignore` globs control which files are hidden in the artifact diff viewer — useful for keeping the review focused on the things that matter to you.

```toml
[diff]
ignore = [
  "**/*.test.ts",
  "**/*.spec.ts",
  "src/generated/**",
  "pnpm-lock.yaml",
]
```

---

## Management UI

```
nightshift serve
```

Starts a local web UI.

### Team view

Each team has a chat interface. By default the lead responds. `@mention` a member to address them directly. Use this to ask questions, give direction, or catch up on what the team has been working on — no code changes happen here.

### Project view

When work needs to happen, the team works within a project. The project view has:

- **Chat** — same as team chat, but agents work within the project worktree. The lead delegates tasks to members in sequence, waiting for each to complete before continuing.
- **Artifacts** — a diff of everything changed in the project so far, filtered by your `nightshift.toml` ignore rules. Gives you a view of the work without having to look at code unless you want to.
- **Inline comments** — leave comments directly on artifacts. They aren't sent immediately. When you send your next message in project chat, all pending comments are bundled with it so the team can address everything in one pass.
