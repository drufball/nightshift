export function Breadcrumb({
  teamId,
  projectName,
  agentName,
}: {
  teamId: string;
  projectName?: string;
  agentName?: string;
}) {
  if (agentName) {
    return (
      <>
        <span className="text-primary">
          ~/{teamId}/{agentName}
        </span>
        {projectName && (
          <span className="text-secondary ml-1">({projectName})</span>
        )}
      </>
    );
  }
  if (projectName) {
    return (
      <>
        <span className="text-primary">~/{teamId}</span>
        <span className="text-secondary ml-1">({projectName})</span>
      </>
    );
  }
  return <span className="text-primary">~/{teamId}</span>;
}
