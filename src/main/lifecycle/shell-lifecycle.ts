import { allowInWindow } from '../tabs/rate-window'

type GoneListener = (event: unknown, details: { reason: string }) => void
type NavListener = (details: { isMainFrame: boolean; isSameDocument: boolean; url: string }) => void

/** The parts of the shell's WebContents this watcher needs, so it can be tested with an EventEmitter. */
export type ShellContentsLike = {
  on(event: 'render-process-gone', listener: GoneListener): unknown
  on(event: 'did-start-navigation', listener: NavListener): unknown
  off(event: 'render-process-gone', listener: GoneListener): unknown
  off(event: 'did-start-navigation', listener: NavListener): unknown
}

const CRASH_RELOADS = 3
const CRASH_WINDOW_MS = 60_000

/**
 * Tab views belong to one shell document. When that document goes away (renderer crash, reload, dev full reload),
 * its views would be orphaned on top of the new document, so they are all destroyed; the new document wakes the
 * tabs it shows again. After a crash the shell is reloaded, at most 3 times a minute, never while quitting.
 * Returns a disposer.
 */
export function watchShell(deps: {
  contents: ShellContentsLike
  destroyAllTabs: () => void
  reload: () => void
  isShuttingDown: () => boolean
  /** True for the shell's own page URL. */
  isAppUrl: (url: string) => boolean
  now: () => number
  onLog: (message: string) => void
}): () => void {
  let crashes: readonly number[] = []
  const onGone: GoneListener = (_event, details) => {
    deps.destroyAllTabs()
    if (deps.isShuttingDown() || details.reason === 'clean-exit') return
    const r = allowInWindow(crashes, deps.now(), CRASH_RELOADS, CRASH_WINDOW_MS)
    crashes = r.history
    if (r.allowed) deps.reload()
    else deps.onLog(`[shell] renderer gone (${details.reason}) again; not reloading after ${CRASH_RELOADS} reloads in a minute`)
  }
  // Destroy when the shell starts loading its own page again (reload, dev full reload). Not on commit: the new
  // document can wake its tabs before main handles the commit, and those views would be destroyed by mistake.
  // Navigations to other URLs are blocked by the shell lock, so they are ignored here.
  const onNavigate: NavListener = (d) => {
    if (d.isMainFrame && !d.isSameDocument && deps.isAppUrl(d.url)) deps.destroyAllTabs()
  }
  deps.contents.on('render-process-gone', onGone)
  deps.contents.on('did-start-navigation', onNavigate)
  return () => {
    deps.contents.off('render-process-gone', onGone)
    deps.contents.off('did-start-navigation', onNavigate)
  }
}
