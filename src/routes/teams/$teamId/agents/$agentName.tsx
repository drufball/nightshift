import { createFileRoute } from '@tanstack/react-router';
import { AgentSessionView } from '../-agent-session-view';
import { useTeamPageContext } from '../../$teamId';

export const Route = createFileRoute('/teams/$teamId/agents/$agentName')({
  component: AgentSessionView_,
});

function AgentSessionView_() {
  const { agentName } = Route.useParams();
  const { navBlocks, focusedIdx, setFocusedIdx, bottomRef } =
    useTeamPageContext();
  return (
    <AgentSessionView
      agentName={agentName}
      navBlocks={navBlocks}
      focusedIdx={focusedIdx}
      onFocusBlock={setFocusedIdx}
      bottomRef={bottomRef}
    />
  );
}
