# Flow 02: Project context — switch in, chat, view session, switch between projects

Open the project picker, switch into a project, verify context scoping, send a
message, view the agent session, then switch directly to a second project without
returning to team chat.

## Setup

```bash
bun qa/fixture.ts --reset
cd /tmp/nightshift-qa-fixture && ns serve --port 3001
# open http://localhost:3001
```

App opens on the feature-team chat in NORMAL mode.

---

## Steps

### 1. Open the project picker

From the team chat view, press `p` (in NORMAL mode) or click `2 projects` in
the status bar.

**Expected:**
- The input area becomes focused (INSERT mode)
- An inline list appears above the prompt showing the 2 projects:
  `auth-backend` and `auth-ui`
- A `+ new project` option appears at the bottom of the list
- Breadcrumb still shows `~/feature-team`

### 2. Select auth-backend

The first project (`auth-backend`) should be highlighted by default. Press
`Enter` to select it.

**Expected:**
- Picker closes
- View switches to project chat
- Breadcrumb updates to `~/feature-team (auth-backend)`
- Thread shows the 3 pre-seeded auth-backend messages (user + 2 from tech-lead)
- Status bar still shows `2 projects (p)` and `3 agents (a)`

### 3. Verify project scope on agents

Press `a` (in NORMAL mode) or click `3 agents` in the status bar.

**Expected:**
- Agent picker opens listing all 3 agents
- Select `tech-lead` by pressing `Enter`
- View switches to `~/feature-team/tech-lead (project)` — the `(project)` suffix
  confirms the session is scoped to auth-backend
- The session view shows tech-lead's tool calls / thinking from working on this project
  (or is empty if no SDK session was recorded)

### 4. Return to project chat

Press `-` to go back.

**Expected:**
- View returns to project chat (`~/feature-team (auth-backend)`)
- Message thread is intact

### 5. Send a message in project context

Press `i`, type:

```
What's left to implement on the register endpoint?
```

Press `Enter`.

**Expected:**
- Message appears in the project thread (not in team chat)
- Working indicator shows the responding agent
- Response arrives in the project thread
- Navigating back to team chat (`-`) shows the team thread unchanged (no project
  messages bled in)

### 6. Switch directly to a second project

Navigate back into auth-backend (`p` → Enter). Then press `p` again and select
`auth-ui`.

**Expected:**
- View switches directly from auth-backend to auth-ui without passing through team chat
- Breadcrumb updates to `~/feature-team (auth-ui)`
- Thread shows "No messages in auth-ui yet." — no auth-backend messages visible
- Pressing `a` and selecting `tech-lead` opens a session scoped to auth-ui (not auth-backend)

