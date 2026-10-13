import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'

// The plugin's React Compiler diagnostics. Its two classic hooks rules are left out: they
// check hook order and dependency arrays, not what the compiler can optimize, and would mix
// unrelated warnings into this list. Warnings, so the existing findings do not fail lint.
// They are not a safety net: the compiler cannot see a mutable object read during render
// (the Tiptap editor, for one), and a component it compiled can still warn.
const reactCompilerRules = Object.fromEntries(
  Object.keys(reactHooks.configs['recommended-latest'].rules)
    .filter((name) => !['react-hooks/rules-of-hooks', 'react-hooks/exhaustive-deps'].includes(name))
    .map((name) => [name, 'warn'])
)

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
      '.design-bundle/',
      '.claude/',
      '.agents/',
      '.codex/',
      // sharp built for the test runner by scripts/build-test-sharp.mjs.
      '.cache/test-sharp/',
      'Python/',
      // Checked-in prototype artifacts, not app code — see docs/design-handoff/.
      'docs/**/*.js',
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
    files: ['scripts/**/*.mjs', '.github/scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        fetch: 'readonly'
      }
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactCompilerRules
  },
  {
    files: ['e2e/**/*.ts'],
    rules: {
      'no-empty-pattern': 'off'
    }
  },
  {
    // Raw connection access is restricted to the aggregate repos in services/db/
    files: ['src/main/**/*.ts'],
    ignores: ['src/main/services/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@main/services/db/core',
              importNames: ['getDb'],
              message: 'Raw connection access is restricted to src/main/services/db/'
            }
          ]
        }
      ]
    }
  }
)
