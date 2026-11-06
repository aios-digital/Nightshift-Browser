import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { watchShell } from './shell-lifecycle'

const APP = 'file:///app/index.html'

function setup(opts: { shuttingDown?: boolean } = {}) {
  const contents = new EventEmitter()
  let t = 0
  const deps = {
    contents,
    destroyAllTabs: vi.fn(),
    reload: vi.fn(),
    isShuttingDown: () => opts.shuttingDown ?? false,
    now: () => t,
    onLog: vi.fn(),
    isAppUrl: (url: string) => url === APP
  }
  const dispose = watchShell(deps)
  const crash = (reason = 'crashed') => contents.emit('render-process-gone', {}, { reason, exitCode: 1 })
  const start = (url: string, isMainFrame = true, isSameDocument = false) =>
    contents.emit('did-start-navigation', { isMainFrame, isSameDocument, url })
  const navigate = () => start(APP)
  const startOnly = () => start('https://evil.test/')
  return { deps, dispose, crash, navigate, startOnly, contents, advance: (ms: number) => (t += ms) }
}

describe('watchShell', () => {
  it('destroys all tab views when the shell process is gone, then reloads it', () => {
    const { deps, crash } = setup()
    crash()
    expect(deps.destroyAllTabs).toHaveBeenCalledTimes(1)
    expect(deps.reload).toHaveBeenCalledTimes(1)
  })

  it('reloads after a crash at most 3 times in 60 s, then stops and logs', () => {
    const { deps, crash, advance } = setup()
    for (let i = 0; i < 5; i++) crash()
    expect(deps.reload).toHaveBeenCalledTimes(3)
    expect(deps.destroyAllTabs).toHaveBeenCalledTimes(5)
    expect(deps.onLog).toHaveBeenCalledWith(expect.stringMatching(/not reloading/))
    advance(60_001)
    crash()
    expect(deps.reload).toHaveBeenCalledTimes(4)
  })

  it('does not reload during shutdown or after a clean exit', () => {
    const shutting = setup({ shuttingDown: true })
    shutting.crash()
    expect(shutting.deps.reload).not.toHaveBeenCalled()
    expect(shutting.deps.destroyAllTabs).toHaveBeenCalled()
    const clean = setup()
    clean.crash('clean-exit')
    expect(clean.deps.reload).not.toHaveBeenCalled()
  })

  it('destroys all tab views when the shell starts loading its own page again (reload)', () => {
    const { deps, navigate } = setup()
    navigate()
    expect(deps.destroyAllTabs).toHaveBeenCalledTimes(1)
    expect(deps.reload).not.toHaveBeenCalled()
  })

  it('a navigation to another URL (which the shell lock blocks), a sub-frame or a same-document one keeps the tabs', () => {
    const { deps, startOnly, contents } = setup()
    startOnly()
    contents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false, url: APP })
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true, url: APP })
    expect(deps.destroyAllTabs).not.toHaveBeenCalled()
  })

  it('the disposer removes both listeners', () => {
    const { dispose, contents } = setup()
    dispose()
    expect(contents.listenerCount('render-process-gone')).toBe(0)
    expect(contents.listenerCount('did-start-navigation')).toBe(0)
  })
})
