# Conversation Routing

This file specifies the deterministic routing rules used by `runConversationLoop` (team-data.ts) to decide which agent responds next after each message. There is no LLM judge — routing is based entirely on the last message's sender and @mention content.

## Routing Rules

### @user mention (any sender)
Stop the loop and wait for the human. The conversation has been explicitly handed back.

### User message — no @mentions
The **team lead** responds. The lead is the user's primary point of contact.

### User message — with @agent mentions
The **mentioned agents** respond. This is an explicit routing instruction from the human.

### Team lead message — no @mentions
**Stop the loop.** A lead message without mentions is assumed to be directed at the user.

### Team lead message — with @agent mentions
The **mentioned agents** respond. The lead is delegating work.

### Non-lead agent message — no @mentions
The **team lead** responds. The lead coordinates all agent work and fields member output.

### Non-lead agent message — with @agent mentions
The **mentioned agents** respond. This is an explicit handoff between members.

## Constraints

- A 5-minute timeout per agent turn guards against hung SDK streams.

## Examples

**Example 1** — user asks a question, lead handles it:
```
User: What's the status of the login feature?
→ team lead responds
Lead: Everything is on track. @user I'll have an update by end of day.
→ @user detected → stop
```

**Example 2** — user delegates directly to a member:
```
User: @bob please review the PR.
→ bob responds
Bob: Done, LGTM. No issues.
→ bob (non-lead, no mentions) → lead responds
Lead: @user Bob has reviewed the PR and it looks good.
→ @user detected → stop
```

**Example 3** — lead coordinates team:
```
User: Implement the checkout flow.
→ lead responds
Lead: @alice please implement the backend. @bob handle the frontend.
→ alice and bob respond (in sequence)
Alice: Backend done.
Bob: Frontend done.
→ alice and bob (non-lead, no mentions) → lead responds each time
Lead: @user The checkout flow is fully implemented and ready for review.
→ @user detected → stop
```

**Example 4** — lead signals completion to user:
```
User: Summarise what was shipped today.
→ lead responds
Lead: Today we shipped the login page, the checkout flow, and fixed three bugs.
→ lead, no mentions → stop (assumed for user)
```
