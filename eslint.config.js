import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    ignores: [
      'out/',
      'dist/',
      'extension/dist/',
      'node_modules/',
      '.worktrees/',
      '.claude/',
      '.agents/',
      '.codex/',
      'Python/',
      'tests/**/*.js',
      'tests/**/*.d.ts',
      'extension/src/**/*.js',
      'extension/src/**/*.d.ts',
      '*.config.js',
      '*.config.d.ts',
      'vitest.config.js',
      'vitest.config.d.ts',
      'extension/vite.config.js',
      'extension/vite.config.d.ts',
      'electron.vite.config.js',
      'electron.vite.config.d.ts'
    ]
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' }
    }
  },
  {
    files: ['e2e/**/*.ts'],
    rules: {
      'no-empty-pattern': 'off'
    }
  }
)
