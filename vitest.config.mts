import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const alias = { '@shared': resolve('src/shared'), '@': resolve('src/renderer/src') }

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tools/**/*.test.ts'],
    pool: 'threads',
    hookTimeout: 60000,
    testTimeout: 30000,
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: [
        'src/shared/**/*.ts', 'src/main/store/**/*.ts', 'src/main/ipc/guard.ts',
        'src/main/tabs/**/*.ts', 'src/main/lifecycle/**/*.ts', 'src/preload/api.ts',
        'src/renderer/src/store/**/*.ts', 'src/renderer/src/layout/**/*.ts', 'src/renderer/src/i18n/**/*.ts', 'tools/vite/**/*.ts'
      ],
      // Electron adapters need a real Electron runtime; they are covered by the Playwright E2E suite.
      exclude: ['**/*.test.*', '**/types.ts', '**/channels.ts', 'src/main/tabs/electron-view-factory.ts', 'src/main/tabs/view-events.ts', 'src/main/tabs/session-fetch.ts', 'src/main/tabs/session-hardening.ts'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 75 }
    }
  }
})
