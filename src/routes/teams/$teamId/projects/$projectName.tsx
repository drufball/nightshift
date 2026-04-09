import { createFileRoute } from '@tanstack/react-router';
import { ChatView } from '../-chat-view';
import { useTeamPageContext } from '../../$teamId';

export const Route = createFileRoute('/teams/$teamId/projects/$projectName')({
  component: ProjectChatView,
});

function ProjectChatView() {
  const { projectName } = Route.useParams();
  const { navBlocks, focusedIdx, setFocusedIdx, bottomRef } =
    useTeamPageContext();
  return (
    <ChatView
      navBlocks={navBlocks}
      focusedIdx={focusedIdx}
      onFocusBlock={setFocusedIdx}
      bottomRef={bottomRef}
      emptyText={`No messages in ${projectName} yet.`}
    />
  );
}
