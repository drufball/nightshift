# Conversation Routing

This file specifies the deterministic routing rules used by `runConversationLoop` (team-data.ts) to decide which agent responds next after each message. Routing is based entirely on the last message's sender and @mention content.

## User messages

### No @mentions
The **team lead** responds. The lead is the user's primary point of contact.

### With @agent mentions
The **mentioned agents** respond, in the order mentioned.

## Team lead messages

### With @user mention
Stop the loop. The conversation has been explicitly handed back.

### No @mentions
**Stop the loop.** A lead message without mentions is assumed to be directed at the user.

### With @agent mentions
The **mentioned agents** respond, in the order mentioned. The lead is delegating work.

## Team member messages

### With @user mention
Stop the loop. The conversation has been explicitly handed back.

### No @mentions
The **team lead** responds. The lead coordinates all agent work and fields member output.

### With @agent mentions
The **mentioned agents** respond, in the order mentioned. This is an explicit handoff between members.

## Constraints

- A 5-minute timeout per agent turn guards against hung SDK streams.
