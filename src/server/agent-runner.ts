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

/** Returns the filename of the appropriate prompt spec template. */
export function selectPromptTemplate(
  isLead: boolean,
  projectBranch?: string,
): string {
  const context = projectBranch ? 'project' : 'team';
  const role = isLead ? 'lead' : 'member';
  return `${context}-${role}-prompt.spec.md`;
}

/** Loads the prompt spec template for the given role and context. */
export async function loadPromptTemplate(
  isLead: boolean,
  projectBranch?: string,
): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const filename = selectPromptTemplate(isLead, projectBranch);
  // Use import.meta.url (not import.meta.dir) so this works in both dev and
  // bundled environments where import.meta.dir may be undefined.
  const templatePath = new URL(filename, import.meta.url).pathname;
  return readFile(templatePath, 'utf-8');
}

/**
 * Builds the complete system prompt by substituting dynamic data into the
 * loaded spec template. The template uses ${placeholder} syntax.
 *
 * Placeholders:
 *   ${agentPrompt}    — the agent's core instructions
 *   ${teamName}       — the team name
 *   ${teamFolder}     — path to the team folder
 *   ${projectBranch}  — current git branch (project templates only)
 *   ${memberLines}    — formatted team roster
 */
export function buildSystemPrompt(
  templateContent: string,
  agentPrompt: string,
  teamName: string,
  teamFolder: string,
  teamMembers: Array<{ name: string; description: string; isLead: boolean }>,
  projectBranch?: string,
): string {
  const memberLines = teamMembers
    .map(
      (m) =>
        `- **${m.name}**${m.isLead ? ' (lead)' : ''}: ${m.description || m.name}`,
    )
    .join('\n');

  return templateContent
    .replace('${agentPrompt}', agentPrompt)
    .replace('${teamName}', teamName)
    .replace('${teamFolder}', teamFolder)
    .replace('${projectBranch}', projectBranch ?? '')
    .replace('${memberLines}', memberLines)
    .trim();
}

export function formatToolStatus(
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

/**
 * Returns true when enough new thinking text has accumulated to warrant a
 * status update. Throttles DB writes to ~1 per 150 chars.
 */
export function shouldFlushThinking(
  bufferLength: number,
  lastFlushAt: number,
): boolean {
  return bufferLength - lastFlushAt >= 150;
}

export async function runAgent({
  agentName,
  userMessage,
  chatContext = [],
  teamMembers = [],
  teamName,
  teamFolder,
  projectBranch,
  cwd,
  worktreeDir,
  existingSdkSessionId,
  onStatus,
  onSessionId,
}: {
  agentName: string;
  userMessage: string;
  chatContext?: Message[];
  teamMembers?: Array<{ name: string; description: string; isLead: boolean }>;
  teamName?: string;
  teamFolder?: string;
  projectBranch?: string;
  /**
   * Git root — used to locate nightshift config files (.nightshift/agents/,
   * .nightshift/teams/). Always the repo root, even for project agents.
   */
  cwd: string;
  /**
   * Worktree directory for the project. When set, Claude Code runs here so it
   * can edit files on the project branch. Nightshift config is still read from
   * `cwd` (the repo root).
   */
  worktreeDir?: string;
  /** Pass an existing SDK session ID to resume a prior conversation. */
  existingSdkSessionId?: string;
  /** Called whenever the agent's status changes (tool use, thinking, idle). */
  onStatus?: (status: 'idle' | 'working', statusText?: string) => void;
  /** Called once with the new SDK session ID so callers can persist it. */
  onSessionId?: (sessionId: string) => void;
}): Promise<string> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  const { join } = await import('node:path');
  // Always read agent metadata from the repo root, not the worktree.
  const meta = await readAgentMeta(cwd, agentName);
  const resolvedTeamName = teamName ?? agentName;
  const resolvedTeamFolder =
    teamFolder ?? join('.nightshift', 'teams', resolvedTeamName);

  const agentIsLead = teamMembers.some((m) => m.name === agentName && m.isLead);
  const templateContent = await loadPromptTemplate(agentIsLead, projectBranch);

  const systemPrompt = buildSystemPrompt(
    templateContent,
    meta.systemPrompt,
    resolvedTeamName,
    resolvedTeamFolder,
    teamMembers,
    projectBranch,
  );

  const formattedChat =
    chatContext.length > 0
      ? chatContext
          .map(
            (m) => `${m.sender === 'user' ? 'User' : m.sender}: ${m.content}`,
          )
          .join('\n')
      : null;

  const messageWithContext = formattedChat
    ? `Recent chat:\n\n${formattedChat}\n\n---\n\n${userMessage}`
    : userMessage;

  onStatus?.('working', 'thinking...');

  let result = '';

  try {
    const stream = query({
      prompt: messageWithContext,
      options: {
        cwd: worktreeDir ?? cwd,
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
        ...(existingSdkSessionId
          ? { resume: existingSdkSessionId }
          : { systemPrompt }),
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
                  onStatus?.('working', status);
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
        !existingSdkSessionId
      ) {
        onSessionId?.(message.session_id);
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
          if (shouldFlushThinking(thinkingBuffer.length, thinkingUpdateAt)) {
            thinkingUpdateAt = thinkingBuffer.length;
            onStatus?.('working', thinkingBuffer);
          }
        }

        if (event?.type === 'content_block_stop' && thinkingBuffer) {
          onStatus?.('working', thinkingBuffer);
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
    onStatus?.('idle');
  }

  return result;
}
