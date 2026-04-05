import { Link, createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { Badge } from '~/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '~/components/ui/breadcrumb';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { ScrollArea } from '~/components/ui/scroll-area';
import { Separator } from '~/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '~/components/ui/sidebar';
import type { Message } from '~/db/messages';
import { cn } from '~/lib/utils';
import {
  type AgentSessionMessage,
  getAgentSession,
  getAgentStatuses,
  getLatestMessages,
  getTeamView,
  sendTeamMessage,
} from '~/server/team-data';

export const Route = createFileRoute('/teams/$teamId')({
  loader: ({ params }) => getTeamView({ data: { teamId: params.teamId } }),
  component: TeamPage,
});

type AgentInfo = {
  name: string;
  isLead: boolean;
  status: 'idle' | 'working';
  statusText: string | null;
};

type SessionData = {
  messages: AgentSessionMessage[];
  status: 'idle' | 'working';
  statusText: string | null;
};

function AgentStatusDot({ status }: { status: 'idle' | 'working' }) {
  return (
    <span
      className={cn(
        'inline-block size-2 rounded-full shrink-0',
        status === 'working'
          ? 'bg-primary animate-pulse'
          : 'bg-muted-foreground/40',
      )}
    />
  );
}

function TeamPage() {
  const initialData = Route.useLoaderData();
  const { teamId } = Route.useParams();

  const [messages, setMessages] = useState<Message[]>(initialData.messages);
  const [agents, setAgents] = useState<AgentInfo[]>(initialData.agents);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sessionBottomRef = useRef<HTMLDivElement>(null);

  const sendFn = useServerFn(sendTeamMessage);
  const getStatusesFn = useServerFn(getAgentStatuses);
  const getAgentSessionFn = useServerFn(getAgentSession);
  const getMessagesFn = useServerFn(getLatestMessages);

  // Poll agent statuses and messages while a send is in flight
  useEffect(() => {
    if (!sending) return;
    const id = setInterval(async () => {
      const [sessions, freshMessages] = await Promise.all([
        getStatusesFn({ data: { teamId } }),
        getMessagesFn({ data: { teamId } }),
      ]);
      setAgents((prev) =>
        prev.map((a) => {
          const s = sessions.find((s) => s.agent_name === a.name);
          return s ? { ...a, status: s.status, statusText: s.status_text } : a;
        }),
      );
      setMessages(freshMessages);
    }, 1500);
    return () => clearInterval(id);
  }, [sending, teamId, getStatusesFn, getMessagesFn]);

  // Poll session history while an agent is selected
  useEffect(() => {
    if (!selectedAgent) return;

    async function fetchSession() {
      if (!selectedAgent) return;
      const data = await getAgentSessionFn({
        data: { teamId, agentName: selectedAgent },
      });
      setSessionData(data as SessionData);
      setTimeout(
        () => sessionBottomRef.current?.scrollIntoView({ behavior: 'smooth' }),
        50,
      );
    }

    fetchSession();

    const agentStatus = agents.find((a) => a.name === selectedAgent)?.status;
    if (agentStatus !== 'working') return;

    const id = setInterval(fetchSession, 2000);
    return () => clearInterval(id);
  }, [selectedAgent, agents, teamId, getAgentSessionFn]);

  async function handleSend() {
    const content = input.trim();
    if (!content) return;
    setInput('');
    setSending(true);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      team_id: teamId,
      project_id: null,
      sender: 'user',
      content,
      mentions: '[]',
      created_at: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      await sendFn({ data: { teamId, content } });
      // Final sync: pick up any messages that arrived after the last poll
      const [finalMessages, sessions] = await Promise.all([
        getMessagesFn({ data: { teamId } }),
        getStatusesFn({ data: { teamId } }),
      ]);
      setMessages(finalMessages);
      setAgents((prev) =>
        prev.map((a) => {
          const s = sessions.find((s) => s.agent_name === a.name);
          return s ? { ...a, status: s.status, statusText: s.status_text } : a;
        }),
      );
      setTimeout(
        () => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }),
        50,
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarContent>
          {/* Breadcrumb */}
          <div className="px-4 py-3">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link to="/">teams</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{teamId}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>

          <Separator />

          {/* Agents */}
          <SidebarGroup>
            <SidebarGroupLabel>Agents</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {/* Team chat nav item */}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={selectedAgent === null}
                    onClick={() => setSelectedAgent(null)}
                    className="font-mono text-sm"
                  >
                    team chat
                  </SidebarMenuButton>
                </SidebarMenuItem>

                {agents.map((agent) => (
                  <SidebarMenuItem key={agent.name}>
                    <SidebarMenuButton
                      isActive={selectedAgent === agent.name}
                      onClick={() => setSelectedAgent(agent.name)}
                      className="h-auto py-2 flex-col items-start gap-0.5"
                    >
                      <div className="flex items-center gap-2 w-full">
                        <AgentStatusDot status={agent.status} />
                        <span className="font-mono text-sm truncate">
                          {agent.name}
                        </span>
                        {agent.isLead && (
                          <Badge
                            variant="secondary"
                            className="ml-auto text-xs py-0 shrink-0"
                          >
                            lead
                          </Badge>
                        )}
                      </div>
                      {agent.statusText && (
                        <span className="text-xs text-muted-foreground pl-4 truncate w-full">
                          {agent.statusText}
                        </span>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <Separator />

          {/* Projects */}
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {initialData.projects.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-muted-foreground font-mono">
                    No open projects
                  </p>
                ) : (
                  initialData.projects.map((project) => (
                    <SidebarMenuItem key={project.id}>
                      <SidebarMenuButton className="font-mono text-sm">
                        {project.name}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset>
        {selectedAgent === null ? (
          <TeamChatView
            teamId={teamId}
            messages={messages}
            input={input}
            sending={sending}
            bottomRef={bottomRef}
            onInputChange={setInput}
            onSend={handleSend}
          />
        ) : (
          <AgentSessionView
            agentName={selectedAgent}
            sessionData={sessionData}
            sessionBottomRef={sessionBottomRef}
          />
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}

function TeamChatView({
  teamId,
  messages,
  input,
  sending,
  bottomRef,
  onInputChange,
  onSend,
}: {
  teamId: string;
  messages: Message[];
  input: string;
  sending: boolean;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  onInputChange: (v: string) => void;
  onSend: () => void;
}) {
  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center gap-3 px-6 py-4 border-b shrink-0">
        <h1 className="font-mono font-medium text-sm">{teamId}</h1>
        <span className="text-muted-foreground text-xs">team chat</span>
      </div>

      <ScrollArea className="flex-1 px-6">
        <div className="py-4 flex flex-col gap-3">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Send a message to get started.
            </p>
          )}
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="px-6 py-4 border-t shrink-0">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
        >
          <Input
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder="Message the team…"
            disabled={sending}
            className="font-mono text-sm"
          />
          <Button type="submit" disabled={sending || !input.trim()} size="sm">
            {sending ? 'Waiting…' : 'Send'}
          </Button>
        </form>
      </div>
    </div>
  );
}

function AgentSessionView({
  agentName,
  sessionData,
  sessionBottomRef,
}: {
  agentName: string;
  sessionData: SessionData | null;
  sessionBottomRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center gap-3 px-6 py-4 border-b shrink-0">
        <h1 className="font-mono font-medium text-sm">{agentName}</h1>
        <span className="text-muted-foreground text-xs">session history</span>
        {sessionData?.status === 'working' && (
          <span className="ml-auto text-xs text-muted-foreground font-mono animate-pulse truncate max-w-[60%]">
            {sessionData.statusText ?? 'working…'}
          </span>
        )}
      </div>

      <ScrollArea className="flex-1 px-6">
        <div className="py-4 flex flex-col gap-4">
          {!sessionData || sessionData.messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No session history yet.
            </p>
          ) : (
            sessionData.messages.map((msg) => (
              <SessionTurn key={msg.uuid} msg={msg} />
            ))
          )}
          <div ref={sessionBottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; content: unknown }
  | { type: string; [key: string]: unknown };

function SessionTurn({ msg }: { msg: AgentSessionMessage }) {
  if (msg.type === 'system') return null;

  const raw = msg.message;
  const role = (raw?.role as string | undefined) ?? msg.type;
  const isUser = role === 'user';

  const content = raw?.content;
  const blocks: ContentBlock[] = (() => {
    if (!content) return [];
    if (typeof content === 'string') return [{ type: 'text', text: content }];
    if (Array.isArray(content)) return content as ContentBlock[];
    return [];
  })();

  // Skip tool-result-only user messages — these are just API round-trips, not chat
  if (
    isUser &&
    blocks.length > 0 &&
    blocks.every((b) => b.type === 'tool_result')
  ) {
    return null;
  }

  if (blocks.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <span
        className={cn(
          'text-xs font-mono font-bold',
          isUser ? 'text-primary' : 'text-secondary',
        )}
      >
        {isUser ? 'you' : role}
      </span>
      <div className="flex flex-col gap-1">
        {blocks.map((block, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks within a message are stable and have no unique IDs
          <SessionBlock key={i} block={block} isUser={isUser} />
        ))}
      </div>
    </div>
  );
}

function SessionBlock({
  block,
  isUser,
}: {
  block: ContentBlock;
  isUser: boolean;
}) {
  if (block.type === 'text') {
    const text = block as { type: 'text'; text: string };
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none text-sm text-foreground">
        <Markdown>{text.text}</Markdown>
      </div>
    );
  }

  if (block.type === 'thinking') {
    const thinking = block as { type: 'thinking'; thinking: string };
    return (
      <details className="text-xs text-muted-foreground/50 font-mono">
        <summary className="cursor-pointer select-none">thinking</summary>
        <p className="mt-1 whitespace-pre-wrap">{thinking.thinking}</p>
      </details>
    );
  }

  if (block.type === 'tool_use') {
    const tool = block as { type: 'tool_use'; name: string; input: unknown };
    return (
      <details className="text-xs text-muted-foreground/50 font-mono">
        <summary className="cursor-pointer select-none">{tool.name}</summary>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(tool.input, null, 2)}
        </pre>
      </details>
    );
  }

  // tool_result blocks are filtered at the turn level; skip here
  return null;
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.sender === 'user';
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={cn(
          'text-xs font-mono font-bold',
          isUser ? 'text-primary' : 'text-secondary',
        )}
      >
        {isUser ? 'you' : message.sender}
      </span>
      <div className="prose prose-sm dark:prose-invert max-w-none text-sm text-foreground">
        <Markdown>{message.content}</Markdown>
      </div>
    </div>
  );
}
