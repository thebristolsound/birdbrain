// @ts-check
// Deep-module enforcement for dependency-cruiser.
//
// Each package under the packages root is a deep module: a lot of behaviour behind a small
// interface. A package's public surface is its entry points, the files at the package root.
// Implementation lives in subfolders and is private: by convention `lib/` for implementation and
// `tests/` for tests, though any subfolder is private. A package may expose several small entry
// points (index.ts, client.ts, server.ts, ...); prefer that over one giant barrel index.
//
// The only thing you should ever need to edit here is PACKAGES_ROOT.

/** Where packages live. One immediate child dir per package (flat, no nesting). */
const PACKAGES_ROOT = 'src/packages'

// --- derived patterns (no need to edit) -------------------------------------
const R = PACKAGES_ROOT
/**
 * A package's private internals: anything nested inside a package subfolder. The package's root
 * files are its entry points and are NOT matched here; they stay importable from outside.
 */
const PACKAGE_INTERNALS = `^${R}/[^/]+/[^/]+/`

/* global module */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'entrypoint-boundary-from-app',
      comment:
        "App/root code may import a package's entry points (its root files), but nothing inside " +
        'its subfolders.',
      severity: 'error',
      from: { pathNot: `^${R}/` }, // importer is NOT inside any package
      to: { path: PACKAGE_INTERNALS }
    },
    {
      name: 'entrypoint-boundary-across-packages',
      comment:
        "A package's own files import each other freely, but may reach OTHER packages only " +
        'through their entry points, never their internals.',
      severity: 'error',
      // importer is inside a package ($1), but is not a test file
      from: { path: `^${R}/([^/]+)/`, pathNot: `^${R}/[^/]+/tests/` },
      to: {
        path: PACKAGE_INTERNALS,
        pathNot: `^${R}/$1/` // same package: intra-package freedom
      }
    },
    {
      name: 'tests-through-entrypoints',
      comment:
        "A package's tests exercise it through its entry points like everyone else: they may " +
        "import any package's entry points and their own tests/ fixtures, but never any " +
        "package's internals, not even their own.",
      severity: 'error',
      from: { path: `^${R}/([^/]+)/tests/` }, // a test file, in package $1
      to: {
        path: PACKAGE_INTERNALS,
        pathNot: `^${R}/$1/tests/` // own tests/ fixtures: allowed
      }
    },
    {
      name: 'tests-folder-is-private',
      comment:
        "A package's tests/ folder is reachable only from tests; nothing else may import fixtures.",
      severity: 'error',
      from: { pathNot: `^${R}/[^/]+/tests/` }, // importer is not itself a test
      to: { path: `^${R}/[^/]+/tests/` }
    },
    {
      name: 'no-circular',
      comment:
        'No runtime import cycles. Scope `from` to `^${R}/` to allow cycles outside packages.',
      severity: 'error',
      from: {},
      // A cycle closed only by `import type` edges is erased at compile time and cannot bite at
      // runtime, so it is allowed (dependency-cruiser's own template makes the same exception).
      // tsPreCompilationDeps is what makes those edges visible to the cruise at all.
      to: { circular: true, viaOnly: { dependencyTypesNot: ['type-only'] } }
    }

    // --- Layering (optional, off by default) ----------------------------------
    // Interface-hiding controls HOW you import (through the entry points). Layering controls
    // WHICH packages may depend on which. Add your own rules here, e.g.:
    //
    // {
    //   name: 'ui-may-not-depend-on-billing',
    //   severity: 'error',
    //   from: { path: `^${R}/ui/` },
    //   to: { path: `^${R}/billing/` }
    // }
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Read imports from the TypeScript source, not the transpiled output: with the default
    // (false) an import whose bindings are unused or type-only is elided before the cruise
    // and a deep import can slip through.
    tsPreCompilationDeps: true,
    // dependency-cruiser reads one tsconfig, and no per-process project carries every alias, so
    // the cruise gets its own: tsconfig.boundaries.json maps @main, @renderer, @shared and
    // @extension. An alias missing there leaves its edge unresolved, which no rule can see.
    tsConfig: { fileName: 'tsconfig.boundaries.json' }
    // No `enhancedResolveOptions.extensions` override: dependency-cruiser derives the list from
    // the transpilers it finds (.ts/.tsx/.mts/.cts with typescript installed) and maps an import
    // by emitted name (`./impl.js`, `./impl.mjs`) back to its TypeScript source. An explicit list
    // that omits .mts/.cts leaves such an edge unresolved, and no rule can see an unresolved edge.
  }
}
