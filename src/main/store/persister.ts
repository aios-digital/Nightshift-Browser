export type Persister<T> = {
  schedule: (value: T) => void
  flush: () => Promise<void>
}

/** Debounces writes, keeps only the latest value, and never lets two writes overlap. */
export function createPersister<T>(opts: {
  write: (value: T) => Promise<void>
  debounceMs: number
  onError: (error: unknown) => void
}): Persister<T> {
  let pending: { value: T } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let inflight: Promise<void> | null = null

  const clear = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const run = async (): Promise<void> => {
    clear()
    while (inflight) await inflight
    if (!pending) return
    const { value } = pending
    pending = null
    const current = opts.write(value).catch(opts.onError)
    inflight = current
    try {
      await current
    } finally {
      if (inflight === current) inflight = null
    }
  }

  return {
    schedule(value) {
      pending = { value }
      clear()
      timer = setTimeout(() => void run(), opts.debounceMs)
    },
    flush: run
  }
}
