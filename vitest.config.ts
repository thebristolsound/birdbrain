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
          include: ['tests/**/*.test.ts']
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
          include: ['tests/components/**/*.test.tsx']
        }
      }
    ]
  }
})
