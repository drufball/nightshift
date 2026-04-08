# Flow 06: Keyboard navigation

Exercise all keyboard shortcuts end-to-end without touching the mouse.

## Setup

```bash
bun qa/fixture.ts --reset
cd /tmp/nightshift-qa-fixture && ns serve --port 3001
# open http://localhost:3001
```

App opens on feature-team chat with 6 pre-seeded messages. Start in NORMAL mode.

---

## Shortcuts reference

| Key | Mode | Action |
|-----|------|--------|
| `i` | NORMAL | Enter INSERT mode, focus input |
| `Esc` | INSERT | Return to NORMAL mode (blur input) |
| `p` | NORMAL | Open project picker |
| `t` | NORMAL | Open team picker |
| `a` | NORMAL | Open agent picker |
| `j` | NORMAL | Move focus down through message blocks |
| `k` | NORMAL | Move focus up through message blocks |
| `y` | NORMAL | Copy focused block as a `> quoted reply` into the input |
| `-` | NORMAL | Go back one level in the view hierarchy |
| `↑/↓` | INSERT (picker open) | Navigate picker items |
| `Enter` | INSERT (picker open) | Select highlighted item |
| `Esc` | INSERT (picker open) | Close picker / cancel create |

---

## Steps

### 1. Mode switching

- Status bar shows `NORMAL` — input is blurred
- Press `i` → `NORMAL` disappears, input is focused (INSERT mode)
- Press `Esc` → `NORMAL` reappears, input loses focus

### 2. Navigate message blocks

Press `j`/`k` to move focus through the message blocks. Each paragraph of a
message is a separate focusable block — long messages with multiple paragraphs
show multiple blocks.

**Expected:** Focused block is visually highlighted. `k` moves focus up. `j` moves focus down.

### 3. Quote a message

Navigate to any message block with `j`/`k`, then press `y`.

**Expected:**
- Mode switches to INSERT (input focuses)
- Input is pre-filled with the focused block's text as a quote:
  ```
  > first line of the block
  > second line
  ```
- You can add your reply below the quote and send normally

Press `Esc` to clear and return to NORMAL.

### 4. Navigate the project picker by keyboard

Press `p` → picker opens. Without touching the mouse:
- `↑`/`↓` to move between projects
- Type to filter (e.g. `auth`) — list narrows
- `Enter` to switch into the selected project
- `Esc` to close without switching

### 5. Navigate the agent picker by keyboard

Press `a` → picker opens.
- `↑`/`↓` to move between agents
- `Enter` to open selected agent's session
- While in agent session, press `-` to return to previous view

### 6. Navigate the team picker by keyboard

Press `t` → picker opens.
- `↑`/`↓` to move between teams
- `Enter` on a different team → navigates to that team
- `Esc` to stay on current team

### 7. Back navigation chain

From team chat → press `p` → enter `auth-backend` → press `a` → enter
`tech-lead`.

Now unwind with `-`:
- First `-`: agent-session (in project context) → project chat `~/feature-team (auth-backend)`
- Second `-`: project chat → team chat `~/feature-team`

