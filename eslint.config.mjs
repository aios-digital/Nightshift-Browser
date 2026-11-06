import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['out', 'dist', 'coverage', 'node_modules', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error'
    }
  },
  {
    // Node scripts; callbacks passed to page.evaluate run in the browser.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  }
)
