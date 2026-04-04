# nightshift

## Tech stack

- **Runtime/package manager:** Bun
- **Web app:** TanStack Start (SSR) + React 19, built with Vite — entry at `src/routes/`
- **CLI:** Commander — entry at `src/cli/index.ts`, symlinked to `/usr/local/bin/nightshift-dev`
- **Lint/format:** Biome

## Development approach

Always use red/green TDD: write a failing test first, confirm it fails, then implement.

## Testing & lint

```bash
bun test          # run all tests
bun test:watch    # watch mode
bun lint          # check
bun lint:fix      # auto-fix
```

Test helpers and tmp filesystem fixtures live in `src/__tests__/cli/helpers.ts`.
