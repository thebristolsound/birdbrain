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
      include: [
        'src/main/**/*.ts',
        'src/shared/**/*.ts',
        'src/renderer/**/*.{ts,tsx}'
      ],
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
      ]
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
          exclude: ['tests/renderer/**', 'tests/hooks/**']
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
