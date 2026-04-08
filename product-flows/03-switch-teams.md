# Flow 04: Switch between teams

Switch from feature-team to ops-team and verify all state resets — thread,
projects, agents. Then switch back.

## Setup

```bash
bun qa/fixture.ts --reset
cd /tmp/nightshift-qa-fixture && ns serve --port 3001
# open http://localhost:3001
```

App opens on feature-team chat in NORMAL mode. The fixture provides two teams: `feature-team` and `ops-team`.

---

## Steps

### 1. Open the team picker

Press `t` (NORMAL mode) or click `teams` in the status bar.

**Expected:**
- Team picker opens in INSERT mode
- Both teams listed: `feature-team` and `ops-team`
- Typing filters the list

### 2. Switch to ops-team

Arrow down to `ops-team` and press `Enter`.

**Expected:**
- Navigation happens (URL changes to `/teams/ops-team`)
- Page re-loads with ops-team data
- Thread shows ops-team's 4 pre-seeded messages (k8s migration discussion)
- Status bar shows `1 projects (p)` and `2 agents (a)`
- Breadcrumb shows `~/ops-team`

### 3. Verify ops-team context

Check:
- Press `p` → only `k8s-migration` listed
- Press `a` → agents are `devops-lead` and `sre` (not feature-team agents)
- Press `Esc` to close each picker

### 4. Send a message on ops-team

Press `i`, type:

```
@devops-lead what's the first step for the k8s migration?
```

Press `Enter`.

**Expected:**
- Message appears in ops-team thread
- devops-lead responds

### 5. Switch back to feature-team

Press `t`, select `feature-team`, press `Enter`.

**Expected:**
- feature-team thread intact — ops-team message does not appear
- Projects show `auth-backend` and `auth-ui`
- Agents show `project-lead`, `product-manager`, `tech-lead`

