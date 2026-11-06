import { reaction } from 'mobx'
import { getSnapshot } from 'mobx-state-tree'
import type { PersistedRoot } from '@shared/model/persisted-schema'
import type { RootStoreInstance } from './root-store'

export type Persistence = { flush: () => void; dispose: () => void }

/** Sends a snapshot to main shortly after the model stops changing. Volatile tab state is never in the snapshot. */
export function startPersistence(
  store: RootStoreInstance,
  save: (snapshot: PersistedRoot) => void,
  delayMs: number
): Persistence {
  let timer: ReturnType<typeof setTimeout> | null = null
  let dirty = false

  const send = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    if (!dirty) return
    dirty = false
    save(getSnapshot(store) as PersistedRoot)
  }

  const stop = reaction(
    () => getSnapshot(store),
    () => {
      dirty = true
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(send, delayMs)
    }
  )

  return {
    flush: send,
    dispose() {
      stop()
      if (timer !== null) clearTimeout(timer)
      timer = null
    }
  }
}
