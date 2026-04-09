import { createFileRoute } from '@tanstack/react-router';
import { AgentSessionView } from '../../../-agent-session-view';
import { useTeamPageContext } from '../../../../$teamId';

export const Route = createFileRoute(
  '/teams/$teamId/projects/$projectName/agents/$agentName',
)({
  component: AgentSessionInProjectView,
});

function AgentSessionInProjectView() {
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
