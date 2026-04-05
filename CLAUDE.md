# nightshift

## Tech stack

- **Runtime/package manager:** Bun
- **Web app:** TanStack Start (SSR) + React 19, built with Vite — entry at `src/routes/`
- **CLI:** Commander — entry at `src/cli/index.ts`, symlinked to `/usr/local/bin/nightshift-dev`
- **UI components:** shadcn/ui — design system lives in `src/components/ui/`
- **DB:** bun:sqlite. List `src/db/` to see available tables.

## Development approach

Always use red/green TDD: write a failing test first, confirm it fails, then implement.

All UI work must heavily favour reuse from the design system at `src/components/ui/`. Before building any new UI element, check whether a shadcn component already covers the need. Compose from existing primitives rather than writing custom markup.

## Testing & lint

```bash
bun test          # run all tests
bun test:watch    # watch mode
bun lint          # check
bun lint:fix      # auto-fix
```

Tests are co-located with source files (e.g. `init.ts` + `init.test.ts`). Shared test helpers and tmp filesystem fixtures live in `src/cli/test-helpers.ts`.

For browser/E2E tests use the `playwright-cli` skill.

## More Documentation

<!-- intent-skills:start -->
# Skill mappings - when working in these areas, load the linked skill file into context.
skills:
  - task: "setting up or modifying TanStack Start app structure, Vite plugin, root route, entry points, or routeTree.gen.ts"
    load: "node_modules/@tanstack/start-client-core/skills/start-core/SKILL.md"
  - task: "adding or editing routes in src/routes/"
    load: "node_modules/@tanstack/router-core/skills/router-core/SKILL.md"
  - task: "React-specific router bindings, createStart, StartClient, StartServer, useServerFn"
    load: "node_modules/@tanstack/react-start/skills/react-start/SKILL.md"
  - task: "server functions, data fetching with createServerFn, useServerFn, or route loaders"
    load: "node_modules/@tanstack/start-client-core/skills/start-core/server-functions/SKILL.md"
  - task: "route data loading, caching, staleTime, pendingComponent, or deferred data"
    load: "node_modules/@tanstack/router-core/skills/router-core/data-loading/SKILL.md"
  - task: "adding API endpoints with HTTP method handlers on file routes"
    load: "node_modules/@tanstack/start-client-core/skills/start-core/server-routes/SKILL.md"
<!-- intent-skills:end -->
