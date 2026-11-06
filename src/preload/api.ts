import { CH } from '@shared/ipc/channels'
import type { LayoutPayload, OpenRequest, TabState } from '@shared/ipc/schemas'
import type { PersistedRoot } from '@shared/model/persisted-schema'

/** The slice of ipcRenderer the API needs. The real ipcRenderer is never exposed to the page. */
export type IpcLike = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  send: (channel: string, ...args: unknown[]) => void
  on: (channel: string, listener: (event: unknown, payload: never) => void) => void
  off: (channel: string, listener: (event: unknown, payload: never) => void) => void
}

export function createApi(ipc: IpcLike) {
  const subscribe = <T>(channel: string, cb: (payload: T) => void): (() => void) => {
    const listener = (_event: unknown, payload: T) => cb(payload)
    ipc.on(channel, listener as (event: unknown, payload: never) => void)
    return () => ipc.off(channel, listener as (event: unknown, payload: never) => void)
  }
  const tabCommand = (channel: string) => (tabId: string) => ipc.send(channel, { tabId })

  return {
    store: {
      load: () => ipc.invoke(CH.storeLoad) as Promise<PersistedRoot>,
      save: (snapshot: PersistedRoot) => ipc.send(CH.storeSave, { snapshot })
    },
    shell: {
      onFlushRequest: (cb: () => void) => subscribe<null>(CH.flushRequest, () => cb()),
      flushDone: () => ipc.send(CH.flushDone)
    },
    views: {
      setLayout: (payload: LayoutPayload) => ipc.send(CH.setLayout, payload)
    },
    tabs: {
      wake: (payload: { tabId: string; profileId: string; url: string }) => ipc.invoke(CH.tabWake, payload),
      sleep: tabCommand(CH.tabSleep),
      close: tabCommand(CH.tabClose),
      back: tabCommand(CH.tabBack),
      forward: tabCommand(CH.tabForward),
      reload: tabCommand(CH.tabReload),
      stop: tabCommand(CH.tabStop),
      navigate: (payload: { tabId: string; url: string }) => ipc.send(CH.tabNavigate, payload),
      onState: (cb: (state: TabState) => void) => subscribe<TabState>(CH.tabState, cb),
      onOpenRequest: (cb: (request: OpenRequest) => void) => subscribe<OpenRequest>(CH.tabOpenRequest, cb),
      onFocus: (cb: (payload: { tabId: string }) => void) => subscribe<{ tabId: string }>(CH.tabFocus, cb)
    }
  }
}

export type NsApi = ReturnType<typeof createApi>
