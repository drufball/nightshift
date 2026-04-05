import type { Database } from '~/db/index';
import type { Message } from '~/db/messages';

export interface AgentMeta {
  name: string;
  description: string;
  systemPrompt: string;
}

export function parseAgentMeta(markdownContent: string): AgentMeta {
  const frontmatterMatch = markdownContent.match(
    /^---\n([\s\S]*?)\n---\n([\s\S]*)$/,
  );
  if (!frontmatterMatch) {
    return { name: '', description: '', systemPrompt: markdownContent.trim() };
  }
  const frontmatter = frontmatterMatch[1];
  const body = frontmatterMatch[2].trim();
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? '';
  const description =
    frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '';
  return { name, description, systemPrompt: body };
}

export async function readAgentMeta(
  cwd: string,
  agentName: string,
): Promise<AgentMeta> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const agentPath = join(cwd, '.nightshift', 'agents', `${agentName}.md`);
  const content = await readFile(agentPath, 'utf-8');
  return parseAgentMeta(content);
}

export function buildSystemPrompt(
  agentPrompt: string,
  teamName: string,
  teamFolder: string,
  teamMembers: Array<{ name: string; description: string; isLead: boolean }>,
  chatContext: Message[],
  projectBranch?: string,
): string {
  const parts: string[] = [agentPrompt];

  const memberLines = teamMembers
    .map(
      (m) =>
        `- **${m.name}**${m.isLead ? ' (lead)' : ''}: ${m.description || m.name}`,
    )
    .join('\n');

  const projectLine = projectBranch
    ? `\nCurrent project branch: \`${projectBranch}\``
    : '';

  parts.push(
    `---\n\n## Your Team\n\nTeam: **${teamName}**\nTeam folder: \`${teamFolder}\`${projectLine}\n\nMembers — use @name to mention a teammate and ensure they respond next:\n\n${memberLines}\n\nMention \`@user\` when you need input from the human user before continuing.`,
  );

  if (chatContext.length > 0) {
    const contextLines = chatContext
      .map((m) => `${m.sender === 'user' ? 'User' : m.sender}: ${m.content}`)
      .join('\n');
    parts.push(
      `---\n\n## Recent Team Chat\n\nThe following messages were recently posted in the team chat. Use this as context for your work:\n\n${contextLines}`,
    );
  }

  return parts.join('\n\n');
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

export async function runAgent({
  db,
  teamId,
  agentName,
  userMessage,
  chatContext = [],
  teamMembers = [],
  teamName,
  teamFolder,
  projectBranch,
  cwd,
  projectId,
}: {
  db: Database;
  teamId: string;
  agentName: string;
  userMessage: string;
  chatContext?: Message[];
  teamMembers?: Array<{ name: string; description: string; isLead: boolean }>;
  teamName?: string;
  teamFolder?: string;
  projectBranch?: string;
  cwd: string;
  projectId?: string;
}): Promise<string> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const { getSession, setSessionSdkId, upsertSession } = await import(
    '~/db/sessions'
  );

  const { join } = await import('node:path');
  const meta = await readAgentMeta(cwd, agentName);
  const resolvedTeamName = teamName ?? teamId;
  const resolvedTeamFolder =
    teamFolder ?? join('.nightshift', 'teams', resolvedTeamName);
  const systemPrompt = buildSystemPrompt(
    meta.systemPrompt,
    resolvedTeamName,
    resolvedTeamFolder,
    teamMembers,
    chatContext,
    projectBranch,
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
        break; // stream won't always close cleanly; don't wait for it
      }
    }
  } finally {
    upsertSession(db, teamId, agentName, 'idle', undefined, projectId);
  }

  return result;
}
