export type FrameBatcher = {
  /** Ask for a measurement on the next animation frame. `force` sends even if nothing changed. */
  schedule: (force?: boolean) => void
  dispose: () => void
}

/** Collapses any number of schedule() calls into one measure+send per animation frame, skipping unchanged results. */
export function createFrameBatcher<T>(opts: {
  measure: () => T
  send: (value: T) => void
  equals: (a: T, b: T) => boolean
  raf: (cb: () => void) => number
  caf: (id: number) => void
}): FrameBatcher {
  let handle: number | null = null
  let forced = false
  let disposed = false
  let last: { value: T } | null = null

  const run = () => {
    handle = null
    const value = opts.measure()
    const force = forced
    forced = false
    if (!force && last && opts.equals(last.value, value)) return
    last = { value }
    opts.send(value)
  }

  return {
    schedule(force = false) {
      if (disposed) return
      forced = forced || force
      if (handle === null) handle = opts.raf(run)
    },
    dispose() {
      disposed = true
      if (handle !== null) opts.caf(handle)
      handle = null
    }
  }
}
