import { createFileRoute } from '@tanstack/react-router';
import { useTeamPageContext } from '../$teamId';
import { ChatView } from './-chat-view';

export const Route = createFileRoute('/teams/$teamId/')({
  component: TeamChatView,
});

function TeamChatView() {
  const { navBlocks, focusedIdx, setFocusedIdx, bottomRef } =
    useTeamPageContext();
  return (
    <ChatView
      navBlocks={navBlocks}
      focusedIdx={focusedIdx}
      onFocusBlock={setFocusedIdx}
      bottomRef={bottomRef}
    />
  );
}
