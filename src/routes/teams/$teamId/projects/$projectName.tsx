import { Outlet, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/teams/$teamId/projects/$projectName')({
  component: () => <Outlet />,
});
