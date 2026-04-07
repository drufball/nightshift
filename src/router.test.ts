import { describe, expect, it } from 'bun:test';
import { getRouter } from './router';

/** Recursively collect all route ids from the route tree */
function collectRouteIds(
  // biome-ignore lint/suspicious/noExplicitAny: route tree shape is internal to TanStack Router
  node: any,
  ids: string[] = [],
): string[] {
  if (node?.id) ids.push(node.id as string);
  for (const child of node?.children ?? []) {
    collectRouteIds(child, ids);
  }
  return ids;
}

describe('getRouter route matching', () => {
  it('creates a router with a defined route tree', () => {
    const router = getRouter();
    expect(router).toBeDefined();
    expect(router.routeTree).toBeDefined();
  });

  it('resolves the /teams/$teamId route', () => {
    const router = getRouter();
    const allIds = collectRouteIds(router.routeTree);
    expect(allIds).toContain('/teams/$teamId');
  });

  it('contains all expected route ids', () => {
    const router = getRouter();
    const allIds = collectRouteIds(router.routeTree);
    expect(allIds).toContain('__root__');
    expect(allIds).toContain('/');
    expect(allIds).toContain('/teams/$teamId');
  });
});
