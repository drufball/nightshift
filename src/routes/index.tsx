import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <div>
      <h1>nightshift</h1>
      <p>Create agent teams and let them do the work.</p>
    </div>
  );
}
