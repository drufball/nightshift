import { describe, expect, it } from 'bun:test';
import { getRouter } from './router';

describe('getRouter', () => {
  it('creates a router with the route tree', () => {
    const router = getRouter();
    expect(router).toBeDefined();
    expect(router.routeTree).toBeDefined();
  });
});
