import { ipcMain, type WebContents } from 'electron'
import { z } from 'zod'
import { CH } from '@shared/ipc/channels'
import {
  layoutPayloadSchema, navigatePayloadSchema, savePayloadSchema, tabIdPayloadSchema, wakePayloadSchema
} from '@shared/ipc/schemas'
import type { StoreService } from '../store/store-service'
import type { TabViewManager } from '../tabs/tab-view-manager'
import { guardHandler, isShellEvent } from './guard'

/** Registers every privileged channel. Each is sender-checked and zod-validated; tab views can never reach them. */
export function registerIpc(deps: {
  shell: WebContents
  appUrl: string
  store: StoreService
  tabs: TabViewManager
  onFlushDone: () => void
  onReject: (channel: string, reason: string) => void
}): () => void {
  const trusted = (event: unknown) =>
    isShellEvent(
      event as { sender: unknown; senderFrame: unknown },
      deps.shell as unknown as { mainFrame: unknown },
      deps.appUrl
    )
  const guard = <S extends z.ZodType, R>(channel: string, schema: S, fn: (p: S['_output']) => R) =>
    guardHandler({ schema, isTrusted: trusted, fn, onReject: (reason) => deps.onReject(channel, reason) })

  const disposers: Array<() => void> = []
  const on = (channel: string, h: (event: unknown, raw: unknown) => unknown) => {
    ipcMain.on(channel, (event, raw) => void h(event, raw))
    disposers.push(() => ipcMain.removeAllListeners(channel))
  }
  const handle = (channel: string, h: (event: unknown, raw: unknown) => unknown) => {
    ipcMain.handle(channel, (event, raw) => h(event, raw))
    disposers.push(() => ipcMain.removeHandler(channel))
  }
  const tabCommand = (channel: string, fn: (tabId: string) => void) =>
    on(channel, guard(channel, tabIdPayloadSchema, ({ tabId }) => fn(tabId)))

  handle(CH.storeLoad, guard(CH.storeLoad, z.undefined(), () => deps.store.load()))
  on(CH.storeSave, guard(CH.storeSave, savePayloadSchema, ({ snapshot }) => deps.store.save(snapshot)))
  on(CH.setLayout, guard(CH.setLayout, layoutPayloadSchema, ({ entries }) => deps.tabs.applyLayout(entries)))
  handle(CH.tabWake, guard(CH.tabWake, wakePayloadSchema, (p) => deps.tabs.wake(p)))
  on(CH.tabNavigate, guard(CH.tabNavigate, navigatePayloadSchema, ({ tabId, url }) => deps.tabs.navigate(tabId, url)))
  on(CH.flushDone, guard(CH.flushDone, z.undefined(), () => deps.onFlushDone()))
  tabCommand(CH.tabSleep, (id) => deps.tabs.sleep(id))
  tabCommand(CH.tabClose, (id) => deps.tabs.close(id))
  tabCommand(CH.tabBack, (id) => deps.tabs.back(id))
  tabCommand(CH.tabForward, (id) => deps.tabs.forward(id))
  tabCommand(CH.tabReload, (id) => deps.tabs.reload(id))
  tabCommand(CH.tabStop, (id) => deps.tabs.stop(id))

  return () => disposers.forEach((d) => d())
}
