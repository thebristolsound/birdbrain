import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@extension': resolve(__dirname, 'extension/src')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}', 'src/packages/**/tests/**/*.test.{ts,mts,cts,tsx}'],
    coverage: {
      provider: 'v8',
      // 'json' emits coverage-final.json (per-statement hit counts), which
      // scripts/diff-coverage.mjs needs to score only the lines a PR changed.
      reporter: ['text', 'html', 'json-summary', 'json'],
      reportsDirectory: 'coverage',
      include: [
        'src/main/**/*.ts',
        'src/shared/**/*.ts',
        'src/renderer/**/*.{ts,tsx}',
        'src/packages/**/*.{ts,mts,cts}',
        'scripts/slop-audit/**/*.mjs'
      ],
      exclude: [
        '**/*.d.ts',
        '**/types.ts',
        'src/main/index.ts',
        'src/preload/**',
        'src/renderer/main.tsx',
        'src/renderer/routeTree.gen.ts',
        'src/packages/**/tests/**',
        'tests/**',
        'e2e/**',
        'extension/**',
        'out/**',
        'dist/**'
      ],
      // Coverage is a barbell: the forensic core is locked high, the
      // contract/data layers are held in their target band, and the global
      // floor only ratchets (most remaining uncovered code is presentational
      // .tsx exercised by E2E). With perFile unset (the default), each glob
      // threshold is checked against the AGGREGATE of its matched files, so
      // single-file globs are used for the contract layer to keep each file
      // gated on its own merit. Numbers sit a few points below the measured
      // values so the gate catches regressions without breaking on trivial
      // edits.
      thresholds: {
        // Global ratchet — prevents backslide, does not chase a single number.
        lines: 38,
        statements: 38,
        functions: 75,
        branches: 75,
        // Forensic core (top-level services) — locked at ~90%.
        'src/main/services/*.ts': {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 78
        },
        // Shared verification / schema / ipc contract types.
        'src/shared/**/*.ts': {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 70
        },
        // IPC contract layer — gated per file (measured: handlers ~92%,
        // wrap ~78%) so neither can backslide behind the other's coverage.
        'src/main/ipcHandlers.ts': {
          lines: 88,
          statements: 88,
          functions: 90,
          branches: 80
        },
        'src/main/ipcWrap.ts': {
          lines: 75,
          statements: 75,
          functions: 90,
          branches: 78
        },
        // React Query data layer — query keys + invalidation correctness.
        // The per-domain modules carry the gate; queries.ts is a re-export
        // barrel until the last PR of #229 deletes it, and its entry goes with
        // it. Measured on the api aggregate: 92.94 lines/statements, 92.95
        // functions, 100 branches.
        'src/renderer/lib/api/*.ts': {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 90
        },
        'src/renderer/lib/queries.ts': {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 90
        }
      }
    },
    projects: [
      {
        resolve: {
          alias: {
            '@main': resolve(__dirname, 'src/main'),
            '@shared': resolve(__dirname, 'src/shared'),
            '@renderer': resolve(__dirname, 'src/renderer'),
            '@extension': resolve(__dirname, 'extension/src')
          }
        },
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts', 'src/packages/**/tests/**/*.test.{ts,mts,cts}'],
          exclude: ['tests/renderer/**', 'tests/hooks/**'],
          setupFiles: ['./tests/setup/signing-key.ts']
        }
      },
      {
        plugins: [react()],
        resolve: {
          alias: {
            '@main': resolve(__dirname, 'src/main'),
            '@shared': resolve(__dirname, 'src/shared'),
            '@renderer': resolve(__dirname, 'src/renderer'),
            '@extension': resolve(__dirname, 'extension/src')
          }
        },
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: [
            'tests/components/**/*.test.tsx',
            'tests/renderer/**/*.test.ts',
            'tests/hooks/**/*.test.ts',
            'src/packages/**/tests/**/*.test.tsx'
          ],
          setupFiles: ['./tests/setup/jsdom/layout.ts']
        }
      }
    ]
  }
})
