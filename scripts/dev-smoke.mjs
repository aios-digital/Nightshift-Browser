// Dev smoke test: `npm run dev:smoke`.
// Starts `electron-vite dev` with a throwaway profile, connects over CDP, reloads the shell and checks that it
// renders (the app bar only appears after IPC `store:load` succeeds) with no Content-Security-Policy violations.
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const PORT = 9333
const TIMEOUT_MS = 120_000
const userData = mkdtempSync(join(tmpdir(), 'ns-dev-smoke-'))
// Editors built on Electron can leak ELECTRON_RUN_AS_NODE into child shells; it would start Electron as plain Node.
const env = { ...process.env, NS_USER_DATA_DIR: userData }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn('npx', ['electron-vite', 'dev', '--remoteDebuggingPort', String(PORT)], {
  env,
  shell: process.platform === 'win32',
  stdio: ['ignore', 'pipe', 'pipe']
})
let output = ''
child.stdout.on('data', (d) => (output += d))
child.stderr.on('data', (d) => (output += d))

function stop() {
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
    } catch {
      /* already gone */
    }
  } else child.kill('SIGTERM')
  try {
    // Chromium can hold profile files for a moment after it is killed; cleanup is best effort.
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  } catch {
    process.stderr.write(`note: could not remove ${userData}\n`)
  }
}

async function connect() {
  const deadline = Date.now() + TIMEOUT_MS
  for (;;) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
    } catch (error) {
      if (Date.now() > deadline) throw error
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
}

async function findShell(browser) {
  const deadline = Date.now() + TIMEOUT_MS
  for (;;) {
    const page = browser.contexts().flatMap((c) => c.pages()).find((p) => /^http:\/\/(localhost|127\.0\.0\.1):\d+\/?/.test(p.url()))
    if (page) return page
    if (Date.now() > deadline) throw new Error('dev shell page never appeared')
    await new Promise((r) => setTimeout(r, 500))
  }
}

async function main() {
  const browser = await connect()
  const shell = await findShell(browser)
  const problems = []
  shell.on('console', (m) => {
    if (/Content Security Policy|preamble/i.test(m.text())) problems.push(m.text())
  })
  shell.on('pageerror', (e) => problems.push(String(e)))
  // The page can render without hot reload, so record the browser's own CSP violation events from document start.
  await shell.context().addInitScript(() => {
    window.__nsCsp = []
    document.addEventListener('securitypolicyviolation', (e) =>
      window.__nsCsp.push(`${e.violatedDirective} blocked ${e.blockedURI} at ${e.sourceFile || '?'}:${e.lineNumber} ${e.sample || ''}`)
    )
  })
  await shell.reload()
  await shell.waitForSelector('[data-testid="app-bar"]', { timeout: 60_000 })
  await shell.waitForSelector('[data-testid="card"]', { timeout: 30_000 })
  if (process.env.NS_SMOKE_DEBUG) {
    const html = await (await fetch(shell.url(), { headers: { accept: 'text/html' } })).text()
    process.stdout.write(`--- served head ---\n${html.slice(0, html.indexOf('</head>'))}\n`)
  }
  const violations = await shell.evaluate(() => window.__nsCsp ?? ['init script did not run'])
  if (violations.length) {
    const html = await (await fetch(shell.url(), { headers: { accept: 'text/html' } })).text()
    const csp = /Content-Security-Policy"\s+content="([^"]*)"/i.exec(html)?.[1] ?? '(none)'
    problems.push(`CSP violations: ${violations.join('; ')}\nserved CSP: ${csp}`)
  }
  if (problems.length) throw new Error(`dev shell problems:\n${problems.join('\n')}`)
  process.stdout.write(`dev smoke OK: ${shell.url()} rendered with no CSP violations\n`)
  await browser.close().catch(() => undefined)
}

main()
  .then(() => {
    stop()
    process.exit(0)
  })
  .catch((error) => {
    process.stderr.write(`dev smoke FAILED: ${error instanceof Error ? error.message : String(error)}\n--- dev output ---\n${output.slice(-4000)}\n`)
    stop()
    process.exit(1)
  })
