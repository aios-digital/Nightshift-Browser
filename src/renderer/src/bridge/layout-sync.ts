import type { LayoutPayload } from '@shared/ipc/schemas'
import { createFrameBatcher } from '../layout/frame-batcher'
import { layoutsEqual, rectsToLayout } from '../layout/geometry'

export type LayoutSync = {
  /** Registers a card body placeholder for a tab. Returns an unregister function. */
  register: (tabId: string, el: HTMLElement) => () => void
  schedule: () => void
  dispose: () => void
}

/**
 * Measures every registered placeholder once per animation frame and sends the rects to main.
 * Triggered by ResizeObserver, any scroll (captured, since scroll does not bubble) and window resize.
 */
export function createLayoutSync(opts: {
  send: (payload: LayoutPayload) => void
  isErrored: (tabId: string) => boolean
}): LayoutSync {
  const els = new Map<string, HTMLElement>()

  const batcher = createFrameBatcher({
    measure: () =>
      rectsToLayout(
        [...els].map(([tabId, el]) => {
          const r = el.getBoundingClientRect()
          return { tabId, left: r.left, top: r.top, width: r.width, height: r.height, awake: true, error: opts.isErrored(tabId) }
        }),
        { w: window.innerWidth, h: window.innerHeight },
        1
      ),
    send: (entries) => opts.send({ entries }),
    equals: layoutsEqual,
    raf: (cb) => requestAnimationFrame(cb),
    caf: (id) => cancelAnimationFrame(id)
  })

  const schedule = () => batcher.schedule()
  const observer = new ResizeObserver(schedule)
  window.addEventListener('resize', schedule)
  document.addEventListener('scroll', schedule, { capture: true, passive: true })

  return {
    register(tabId, el) {
      els.set(tabId, el)
      observer.observe(el)
      batcher.schedule(true)
      return () => {
        if (els.get(tabId) === el) els.delete(tabId)
        observer.unobserve(el)
        batcher.schedule(true)
      }
    },
    schedule,
    dispose() {
      batcher.dispose()
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('scroll', schedule, { capture: true })
    }
  }
}
