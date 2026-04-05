import type { Database } from '~/db/index';

function parseSystemPrompt(markdownContent: string): string {
  const match = markdownContent.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1].trim() : markdownContent.trim();
}

export async function runLeadAgent({
  db,
  teamId,
  agentName,
  userMessage,
  cwd,
  projectId,
}: {
  db: Database;
  teamId: string;
  agentName: string;
  userMessage: string;
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
  const systemPrompt = parseSystemPrompt(agentContent);

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
        ...(sdkSessionId ? { resume: sdkSessionId } : { systemPrompt }),
        hooks: {
          Notification: [
            {
              hooks: [
                async (input) => {
                  if ('message' in input && typeof input.message === 'string') {
                    upsertSession(
                      db,
                      teamId,
                      agentName,
                      'working',
                      input.message,
                      projectId,
                    );
                  }
                  return {};
                },
              ],
            },
          ],
        },
      },
    });

    for await (const message of stream) {
      if (
        message.type === 'system' &&
        message.subtype === 'init' &&
        !sdkSessionId
      ) {
        setSessionSdkId(db, teamId, agentName, message.session_id, projectId);
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
