import { reaction } from 'mobx'
import type { NsApi } from '../../preload/api'
import type { RootStoreInstance } from './store/root-store'

export type DesiredTab = { tabId: string; profileId: string; url: string; active: boolean }
export type ViewPlan = { wake: Array<{ tabId: string; profileId: string; url: string }>; close: string[] }

/**
 * Decides which native views to create and destroy.
 * `tabs` is every live tab of every awake card. A tab gets a view the first time it is active and keeps it while its
 * card stays awake, so switching tabs does not lose page state.
 */
export function planViews(current: ReadonlySet<string>, tabs: readonly DesiredTab[]): ViewPlan {
  const alive = new Set(tabs.map((t) => t.tabId))
  return {
    wake: tabs
      .filter((t) => t.active && !current.has(t.tabId))
      .map(({ tabId, profileId, url }) => ({ tabId, profileId, url: url || 'about:blank' })),
    close: [...current].filter((id) => !alive.has(id))
  }
}

/** Keeps main's native views in step with the model. Returns a disposer. */
export function startViewSync(store: RootStoreInstance, api: Pick<NsApi, 'tabs'>): () => void {
  const live = new Set<string>()
  const desired = (): DesiredTab[] =>
    (store.activeSpace?.visibleCards ?? [])
      .filter((card) => !card.isSleeping)
      .flatMap((card) =>
        card.visibleTabs.map((tab) => ({
          tabId: tab.id, profileId: card.profileId, url: tab.url, active: tab.id === card.activeTab?.id
        }))
      )

  return reaction(
    () => desired().map((t) => `${t.tabId}|${t.profileId}|${t.active}`).join(','),
    () => {
      const plan = planViews(live, desired())
      for (const w of plan.wake) {
        live.add(w.tabId)
        // If main refuses or the channel is gone (shutdown), forget the view so a later change can retry.
        api.tabs
          .wake(w)
          .then((ok) => {
            if (ok !== true) live.delete(w.tabId)
          })
          .catch(() => live.delete(w.tabId))
      }
      for (const id of plan.close) {
        live.delete(id)
        api.tabs.close(id)
      }
    },
    { fireImmediately: true }
  )
}
