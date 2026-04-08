import type { ViewState } from '../$teamId';

export function Breadcrumb({
  view,
  teamId,
}: {
  view: ViewState;
  teamId: string;
}) {
  switch (view.type) {
    case 'chat':
      return <span className="text-primary">~/{teamId}</span>;
    case 'project-chat':
      return (
        <>
          <span className="text-primary">~/{teamId}</span>
          <span className="text-secondary ml-1">({view.projectName})</span>
        </>
      );
    case 'agent-session':
      return (
        <>
          <span className="text-primary">
            ~/{teamId}/{view.agentName}
          </span>
          {view.projectId && (
            <span className="text-secondary ml-1">(project)</span>
          )}
        </>
      );
  }
}
