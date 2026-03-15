# E2E Testing Design — Birdbrain

## Summary

Add end-to-end testing to the Birdbrain Electron app using Playwright with first-class Electron support. Tests launch the full Electron app, interact with real UI, and verify core CRUD flows. Each test gets a fresh temporary database for full isolation.

## Approach

**Playwright + Electron** — Playwright's `_electron.launch()` API connects to the Electron app's renderer process, providing full browser automation plus main process access via `electronApp.evaluate()`.

### Why Playwright

- First-class Electron support via CDP connection
- Auto-waiting, traces, screenshots for debugging
- Mature ecosystem, active maintenance
- Clean API for both renderer and main process interaction

## Architecture

### Directory Structure

```
e2e/
  fixtures/
    electronApp.ts    # Shared fixture: launch app, manage temp DB, teardown
  cases.spec.ts       # Case CRUD tests
  tags.spec.ts        # Tag CRUD tests
  captures.spec.ts    # Capture management (phase 2)
  app-lifecycle.spec.ts  # App launch, window basics
playwright.config.ts    # Playwright config at project root
```

### App Launch Strategy

1. Build the app once before all tests (`electron-vite build`)
2. Each test file launches a fresh Electron instance
3. Pass custom `BIRDBRAIN_USER_DATA` env var pointing to a temp directory
4. Each test gets a clean SQLite database and storage directory
5. Teardown closes app and deletes temp directory

### Code Change Required

One change in `src/main/index.ts`:

```ts
const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
```

This allows tests to override the data directory. In production, the env var is unset so behavior is unchanged.

### Fixture Design

The `electronApp` fixture:

1. Creates a temp directory via `fs.mkdtemp()`
2. Launches Electron with `_electron.launch({ args: ['./out/main/index.js'], env: { BIRDBRAIN_USER_DATA: tempDir } })`
3. Waits for the first BrowserWindow
4. Yields `page` and `electronApp` to the test
5. On teardown: closes app, deletes temp directory

### Selector Strategy

Use `data-testid` attributes on key interactive elements. This decouples tests from CSS/layout changes and makes test selectors explicit.

## Initial Test Coverage

### Phase 1 — Core CRUD (this implementation)

**app-lifecycle.spec.ts:**
- App launches and shows main window
- Window has correct title
- Dashboard renders

**cases.spec.ts:**
- Create a new case with name and description
- Case appears in case list
- Open a case to view details
- Edit a case name
- Delete a case

**tags.spec.ts:**
- Create a new tag
- Tag appears in tag list
- Rename a tag
- Delete a tag

### Phase 2 — Capture Pipeline (future)

- POST captures to Hono server directly
- Verify captures appear in UI
- Capture detail view

## Configuration

**playwright.config.ts** at project root, separate from vitest config.

**New npm scripts:**
- `pnpm test:e2e` — run E2E tests
- `pnpm test:e2e:debug` — run with Playwright inspector

**Dependencies:**
- `@playwright/test` (dev dependency)

## TDD Workflow

1. Write a failing E2E test describing the desired user flow
2. Add `data-testid` attributes to components as needed
3. Implement the feature until the test passes
4. Refactor if needed, keeping tests green

## Decisions

- **Full Electron app** over headless/renderer-only — maximum confidence
- **Fresh temp DB per test** — full isolation, no state leaks
- **Local-only for now** — no CI setup in this phase
- **Playwright over alternatives** — most mature, best Electron support
