import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts', 'src/renderer/**/*.{ts,tsx}'],
      exclude: [
        '**/*.d.ts',
        '**/types.ts',
        'src/main/index.ts',
        'src/preload/**',
        'src/renderer/main.tsx',
        'src/renderer/routeTree.gen.ts',
        'tests/**',
        'e2e/**',
        'extension/**',
        'out/**',
        'dist/**'
      ],
      // Coverage is a barbell: the forensic core is locked high, the
      // contract/data layers are held in their target band, and the global
      // floor only ratchets (most remaining uncovered code is presentational
      // .tsx exercised by E2E). Per-glob thresholds are aggregate over the
      // matched files. Numbers sit a few points below the measured values so
      // the gate catches regressions without breaking on trivial edits.
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
        // IPC contract layer — target band 70-80%, measured ~90%.
        'src/main/ipc*.ts': {
          lines: 82,
          statements: 82,
          functions: 90,
          branches: 80
        },
        // React Query data layer — query keys + invalidation correctness.
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
            '@renderer': resolve(__dirname, 'src/renderer')
          }
        },
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
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
            '@renderer': resolve(__dirname, 'src/renderer')
          }
        },
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: [
            'tests/components/**/*.test.tsx',
            'tests/renderer/**/*.test.ts',
            'tests/hooks/**/*.test.ts'
          ]
        }
      }
    ]
  }
})
