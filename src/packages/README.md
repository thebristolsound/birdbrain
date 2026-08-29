# Packages

Every folder under `src/packages/` is a deep module: a lot of behavior behind a small interface. The interface is the package's entry points - the files at the package root. Everything below the root is implementation and is private. `pnpm lint:boundaries` (dependency-cruiser, configured in `.dependency-cruiser.cjs`) enforces this, and it runs in `pnpm preflight` and in CI's lint job.

## Layout

Copy `example/` to start a new package:

```
src/packages/
  <name>/
    index.ts        # an entry point (public): import this from outside
    client.ts       # another entry point; a package may expose several
    lib/            # implementation: private, free to import each other
    tests/          # co-located tests and fixtures (a subfolder, so private)
```

Packages are flat: one tier of folders under `src/packages/`, and a package never contains another package. Inside a package, nest as deep as you like.

## Rules

Each rule is an `error` in `.dependency-cruiser.cjs`.

**Entry-point boundary.** Code outside a package - app code in `src/main`, `src/renderer`, and so on, or another package - imports only that package's root files, never anything below its root. Adding an entry point means adding a root file; no configuration changes.

**Intra-package freedom.** A package's own files import each other freely, at any depth.

**Tests through the entry points.** Files under `<name>/tests/` import any package's entry points and their own `tests/` fixtures, but never a file below the root of any package, not even their own. If a test needs to reach past the interface, the interface is the wrong shape. Nothing outside `tests/` imports a `tests/` folder.

**No cycles.** No runtime import cycles anywhere the cruise reaches; a cycle closed only by `import type` edges is allowed, since it is erased at compile time. The cruise resolves `@main/*`, `@renderer/*`, `@shared/*` and `@extension/*` through `tsconfig.boundaries.json`; an alias missing from that file leaves its edges unresolved and invisible to every rule, so add new aliases there too.

## Entry points, not barrels

The public surface is every root file, so expose several small entry points (`index.ts`, `client.ts`, `server.ts`) rather than one `index.ts` that re-exports a whole subtree. A barrel makes the interface as wide as the implementation, which is the shallow module the rules exist to prevent.

## Running the check

```
pnpm lint:boundaries
```

The command cruises `src/`, `extension/src/`, `tests/` and `e2e/` (every first-party importer) and exits non-zero on any violation. The output names the rule and the offending import. The tests for a package live beside it and run with the rest of the suite: `pnpm test src/packages/<name>/tests`.
