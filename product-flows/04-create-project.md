# Flow 05: Create a new project

Create a project from the project picker, verify it starts empty, then send
a first message and get a response.

## Setup

```bash
bun qa/fixture.ts --reset
cd /tmp/nightshift-qa-fixture && ns serve --port 3001
# open http://localhost:3001
```

App opens on feature-team chat in NORMAL mode.

---

## Steps

### 1. Open the project picker

Press `p`.

**Expected:**
- Picker lists the 2 existing projects: `auth-backend`, `auth-ui`
- At the bottom: `+ new project`

### 2. Navigate to "+ new project"

Press `ArrowDown` twice (or type a name that doesn't match any existing project,
e.g. `login`) to move the cursor to `+ new project`. Press `Enter`.

**Expected:**
- Picker transitions to "create" mode
- Breadcrumb above the input changes to `new project  esc to cancel`
- Input clears and shows `project name...` placeholder
- The list disappears

### 3. Type the project name

Type:

```
login-page
```

Press `Enter`.

**Expected:**
- Project created
- View switches to the new project's chat
- Breadcrumb shows `~/feature-team (login-page)`
- Thread is empty: "No messages in login-page yet."
- Status bar updates to `3 projects (p)`

### 4. Send first message

Press `i`, type:

```
Build a login page with email and password fields. Keep it simple for now.
```

Press `Enter`.

**Expected:**
- Message appears in the thread
- Agent responds in project context

### 5. Verify project appears in picker

Press `-` to return to team chat. Press `p`.

**Expected:**
- Picker now lists 3 projects: `auth-backend`, `auth-ui`, `login-page`

### 6. Cancel project creation (optional check)

Press `p` → navigate to `+ new project` → Enter → type something → press `Esc`.

**Expected:**
- Returns to the projects picker (not team chat)
- No project was created
- Press `Esc` again to close the picker entirely

