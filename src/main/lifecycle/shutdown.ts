type Preventable = { preventDefault(): void }

/** The parts of Electron's `app` and `BaseWindow` the shutdown sequence needs, so it can be tested with fakes. */
export type QuitEmitterLike = { on(event: 'before-quit', listener: (e: Preventable) => void): unknown; quit(): void }
export type CloseEmitterLike = { on(event: 'close', listener: (e: Preventable) => void): unknown }

/**
 * Every quit path (window close, app.quit(), the test harness) goes through before-quit. The first one is held
 * back until the renderer has sent its pending save and the store has written it; then the app really quits.
 */
export function installShutdown(deps: {
  app: QuitEmitterLike
  window: CloseEmitterLike
  requestRendererFlush: () => Promise<void>
  flushStore: () => Promise<void>
  teardown: () => void
  onError?: (error: unknown) => void
}): { isShuttingDown(): boolean } {
  let shuttingDown = false
  deps.app.on('before-quit', (event) => {
    if (shuttingDown) return
    event.preventDefault()
    shuttingDown = true
    void deps
      .requestRendererFlush()
      .then(() => deps.flushStore())
      .catch((error: unknown) => deps.onError?.(error))
      .finally(() => {
        deps.teardown()
        deps.app.quit()
      })
  })
  deps.window.on('close', (event) => {
    if (shuttingDown) return
    event.preventDefault()
    deps.app.quit()
  })
  return { isShuttingDown: () => shuttingDown }
}
