import { Link, createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useRef, useState } from 'react';
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
import { getTeamView, sendTeamMessage } from '~/server/team-data';

export const Route = createFileRoute('/teams/$teamId')({
  loader: ({ params }) => getTeamView({ data: { teamId: params.teamId } }),
  component: TeamPage,
});

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
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const sendFn = useServerFn(sendTeamMessage);

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
      const { reply } = await sendFn({ data: { teamId, content } });
      setMessages((prev) => [...prev, reply]);
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
                {initialData.agents.map((agent) => (
                  <SidebarMenuItem key={agent.name}>
                    <SidebarMenuButton className="h-auto py-2 flex-col items-start gap-0.5">
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
        <div className="flex flex-col h-screen">
          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-4 border-b shrink-0">
            <h1 className="font-mono font-medium text-sm">{teamId}</h1>
            <span className="text-muted-foreground text-xs">team chat</span>
          </div>

          {/* Messages */}
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

          {/* Input */}
          <div className="px-6 py-4 border-t shrink-0">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Message the team…"
                disabled={sending}
                className="font-mono text-sm"
              />
              <Button
                type="submit"
                disabled={sending || !input.trim()}
                size="sm"
              >
                Send
              </Button>
            </form>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.sender === 'user';
  return (
    <div
      className={cn(
        'flex flex-col gap-1',
        isUser ? 'items-end' : 'items-start',
      )}
    >
      <span className="text-xs text-muted-foreground font-mono">
        {isUser ? 'you' : message.sender}
      </span>
      <div
        className={cn(
          'rounded-lg px-3 py-2 text-sm max-w-[70%]',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {message.content}
      </div>
    </div>
  );
}
