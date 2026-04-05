import type { Database } from '~/db/index';
import type { Message } from '~/db/messages';

function parseSystemPrompt(markdownContent: string): string {
  const match = markdownContent.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1].trim() : markdownContent.trim();
}

function buildSystemPrompt(
  agentPrompt: string,
  chatContext: Message[],
): string {
  if (chatContext.length === 0) return agentPrompt;

  const contextLines = chatContext
    .map((m) => `${m.sender === 'user' ? 'User' : m.sender}: ${m.content}`)
    .join('\n');

  return `${agentPrompt}

---

## Recent Team Chat
The following messages were recently posted in the team chat. Use this as context for your work:

${contextLines}`;
}

function formatToolStatus(
  toolName: string,
  input: Record<string, unknown>,
): string {
  const params = Object.entries(input)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      let val: string;
      if (typeof v === 'string') {
        val = v.length > 100 ? `${v.slice(0, 100)}…` : v;
      } else if (Array.isArray(v)) {
        val = v.slice(0, 3).join(', ');
        if (v.length > 3) val += `… (+${v.length - 3})`;
      } else {
        val = String(v);
      }
      return `${k}: ${val}`;
    })
    .join('. ');
  return params ? `${toolName} ${params}` : toolName;
}

export async function runLeadAgent({
  db,
  teamId,
  agentName,
  userMessage,
  chatContext = [],
  cwd,
  projectId,
}: {
  db: Database;
  teamId: string;
  agentName: string;
  userMessage: string;
  chatContext?: Message[];
  cwd: string;
  projectId?: string;
}): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const { getSession, setSessionSdkId, upsertSession } = await import(
    '~/db/sessions'
  );

  const agentPath = join(cwd, '.nightshift', 'agents', `${agentName}.md`);
  const agentContent = await readFile(agentPath, 'utf-8');
  const systemPrompt = buildSystemPrompt(
    parseSystemPrompt(agentContent),
    chatContext,
  );

  const existing = getSession(db, teamId, agentName, projectId);
  const sdkSessionId = existing?.sdk_session_id ?? undefined;

  upsertSession(db, teamId, agentName, 'working', 'thinking...', projectId);

  let result = '';

  try {
    const stream = query({
      prompt: userMessage,
      options: {
        cwd,
        allowedTools: [
          'Read',
          'Write',
          'Edit',
          'Bash',
          'Glob',
          'Grep',
          'WebSearch',
          'WebFetch',
        ],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        ...(sdkSessionId ? { resume: sdkSessionId } : { systemPrompt }),
        hooks: {
          PreToolUse: [
            {
              hooks: [
                async (input) => {
                  const toolInput = input as unknown as {
                    tool_name: string;
                    tool_input: Record<string, unknown>;
                  };
                  const status = formatToolStatus(
                    toolInput.tool_name,
                    toolInput.tool_input ?? {},
                  );
                  upsertSession(
                    db,
                    teamId,
                    agentName,
                    'working',
                    status,
                    projectId,
                  );
                  return {};
                },
              ],
            },
          ],
        },
      },
    });

    let thinkingBuffer = '';
    let thinkingUpdateAt = 0;

    for await (const message of stream) {
      if (
        message.type === 'system' &&
        message.subtype === 'init' &&
        !sdkSessionId
      ) {
        setSessionSdkId(db, teamId, agentName, message.session_id, projectId);
      }

      // Parse streaming content blocks to surface thinking as live status
      if (message.type === 'stream_event') {
        // biome-ignore lint/suspicious/noExplicitAny: SDK stream event shapes require any
        const event = (message as any).event as {
          type: string;
          delta?: { type: string; thinking?: string };
        };

        if (
          event?.type === 'content_block_delta' &&
          event.delta?.type === 'thinking_delta' &&
          event.delta.thinking
        ) {
          thinkingBuffer += event.delta.thinking;
          // Update status every ~150 chars to avoid flooding the DB
          if (thinkingBuffer.length - thinkingUpdateAt >= 150) {
            thinkingUpdateAt = thinkingBuffer.length;
            upsertSession(
              db,
              teamId,
              agentName,
              'working',
              thinkingBuffer,
              projectId,
            );
          }
        }

        if (event?.type === 'content_block_stop' && thinkingBuffer) {
          upsertSession(
            db,
            teamId,
            agentName,
            'working',
            thinkingBuffer,
            projectId,
          );
          thinkingBuffer = '';
          thinkingUpdateAt = 0;
        }
      }

      if (message.type === 'result' && message.subtype === 'success') {
        result = message.result;
      }
    }
  } finally {
    upsertSession(db, teamId, agentName, 'idle', undefined, projectId);
  }

  return result;
}
