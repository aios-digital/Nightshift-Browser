import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { devCspPlugin } from './tools/vite/dev-csp'

// Test hooks (evalInTab, crashShell, ...) exist only in builds made with `--mode e2e`; a normal build has none of that code.
export default defineConfig(({ mode }) => ({
  main: {
    define: { __NS_TEST_BUILD__: JSON.stringify(mode === 'e2e') },
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: { alias: { '@shared': resolve('src/shared'), '@': resolve('src/renderer/src') } },
    // devCspPlugin only runs on the dev server; the built index.html keeps the strict production CSP unchanged.
    plugins: [react(), devCspPlugin()],
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } }
  }
}))
