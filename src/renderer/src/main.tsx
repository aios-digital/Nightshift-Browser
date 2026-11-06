import './zod-config'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts'
import './styles/tokens.css'
import './styles/global.css'
import { App } from './App'
import { createLayoutSync } from './bridge/layout-sync'
import { createI18n } from './i18n'
import { startPersistence } from './store/persistence'
import { createRootStore } from './store/root-store'
import { startViewSync } from './view-sync'

async function boot(): Promise<void> {
  const api = window.ns
  const snapshot = await api.store.load()
  if (!snapshot) throw new Error('No state from main')
  const store = createRootStore(snapshot, { now: () => Date.now(), newId: () => crypto.randomUUID() })
  const i18n = await createI18n(store.ui.locale)

  const layoutSync = createLayoutSync({
    send: (payload) => api.views.setLayout(payload),
    isErrored: (tabId) => Boolean(store.findTab(tabId)?.tab.errorText)
  })

  const persistence = startPersistence(store, (s) => api.store.save(s), 300)
  startViewSync(store, api)

  // Events from main. Each subscription returns a disposer; they live as long as the window.
  api.tabs.onState((state) => store.applyTabState(state))
  api.tabs.onFocus(({ tabId }) => {
    const found = store.findTab(tabId)
    if (found) store.setActiveCard(found.card.id)
  })
  api.tabs.onOpenRequest(({ openerTabId, url }) => {
    const opener = store.findTab(openerTabId)
    store.openCard({ url, afterCardId: opener?.card.id, openerTabId, profileId: opener?.card.profileId })
  })
  window.addEventListener('pagehide', () => persistence.flush())
  api.shell.onFlushRequest(() => {
    persistence.flush()
    api.shell.flushDone()
  })

  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <App value={{ store, api, layoutSync }} i18n={i18n} />
    </StrictMode>
  )
}

/** Shown only if the app cannot start. Plain words in both languages; no dependency on i18n or the store. */
function showFatal(): void {
  const root = document.getElementById('root')
  if (!root) return
  const box = document.createElement('div')
  box.setAttribute('role', 'alert')
  box.style.cssText = 'margin:auto;max-width:36ch;padding:48px 24px;text-align:center;line-height:1.6'
  const en = document.createElement('p')
  en.textContent = "NightShift couldn't start. Close it and open it again."
  const ar = document.createElement('p')
  ar.dir = 'rtl'
  ar.lang = 'ar'
  ar.textContent = 'تعذّر تشغيل NightShift. أغلقه ثم افتحه مرة أخرى.'
  box.append(en, ar)
  root.replaceChildren(box)
}

// Links or files dropped on the shell must never navigate it.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

boot().catch(showFatal)
