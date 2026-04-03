import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    ignores: ['out/', 'dist/', 'extension/dist/', 'node_modules/', '.worktrees/', '.claude/', 'Python/']
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
