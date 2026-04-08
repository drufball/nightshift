# Flow 01: Team chat & @mentions

Send a plain message, get a response, then send a message with two @mentions
and verify both mentioned agents respond.

## Setup

```bash
bun qa/fixture.ts --reset
cd /tmp/nightshift-qa-fixture && ns serve --port 3001
# open http://localhost:3001
```

The app redirects to `/teams/feature-team` and lands in NORMAL mode (status bar
shows `NORMAL` on the right). The chat thread shows 6 pre-seeded messages.

---

## Steps

### 1. Send a plain message

Press `i` to enter INSERT mode, or click the textarea directly. The `NORMAL`
indicator disappears when the input is focused.

Type:

```
How's the auth work going so far?
```

Press `Enter` to send (not `Shift+Enter` — that inserts a newline).

**Expected:**
- Message appears immediately in the thread attributed to "you"
- Working agent indicator appears above the input (e.g. `project-lead (c) thinking...`)
- After a moment, one or more agent responses appear in the thread

### 2. Send a message with two explicit @mentions

While still in INSERT mode, type:

```
@product-manager what are the open questions on requirements? @tech-lead what's your ETA on the register endpoint?
```

Press `Enter`.

**Expected:**
- Both `@product-manager` and `@tech-lead` appear highlighted in the sent message
- Both agents respond — you should see responses from each in the thread
- Working agent indicator cycles through both agents as they run

### 3. @mention autocomplete

Click the textarea (or press `i`) and type `@p`. An inline picker appears above
the prompt listing agents whose names match — project-lead and product-manager.

- Arrow up/down to navigate the list, `Enter` to insert the mention
- `Esc` dismisses the picker without inserting

---

## Pass criteria

- Plain message → at least one agent response
- Message with two @mentions → responses from both mentioned agents, in the thread
- @mention autocomplete appears when typing `@`, inserts correctly on Enter
