// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { i18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TabState } from '@shared/ipc/schemas'
import { createDefaultRoot } from '@shared/model/defaults'
import type { NsApi } from '../../../preload/api'
import { AppContext } from '../app-context'
import type { LayoutSync } from '../bridge/layout-sync'
import { createI18n } from '../i18n'
import ar from '../i18n/ar.json'
import { createRootStore } from '../store/root-store'
import { CardNavBar } from './CardNavBar'

afterEach(cleanup)

let ids = 0
const newId = () => `id${++ids}`

async function setup(locale: 'en' | 'ar' = 'en') {
  const store = createRootStore(createDefaultRoot(1, newId), { now: () => 1, newId })
  const card = store.activeSpace!.activeCard!
  const tab = card.activeTab!
  const tabs = { navigate: vi.fn(), back: vi.fn(), forward: vi.fn(), reload: vi.fn(), stop: vi.fn() }
  const api = { tabs } as unknown as NsApi
  const onNavigate = vi.fn()
  const i18n: i18n = await createI18n(locale)
  const view = () => (
    <AppContext.Provider value={{ store, api, layoutSync: {} as LayoutSync }}>
      <I18nextProvider i18n={i18n}>
        <CardNavBar card={card} tab={tab} active onNavigate={onNavigate} />
      </I18nextProvider>
    </AppContext.Provider>
  )
  render(view())
  const state = { url: 'https://a.test/', title: 'A', loading: false, canGoBack: false, canGoForward: false }
  // Model changes re-render observers through React, so they run inside act().
  const apply = (s: Partial<TabState>) => act(() => store.applyTabState({ tabId: tab.id, ...state, ...s }))
  return { store, card, tab, tabs, onNavigate, apply }
}

describe('CardNavBar', () => {
  it('back/forward follow the tab state and are disabled while sleeping', async () => {
    const { store, card, tab, tabs, apply } = await setup()
    const back = () => screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement
    const forward = () => screen.getByRole('button', { name: 'Forward' }) as HTMLButtonElement
    expect(back().disabled).toBe(true)
    apply({ canGoBack: true, canGoForward: true })
    expect(back().disabled).toBe(false)
    expect(forward().disabled).toBe(false)
    fireEvent.click(back())
    fireEvent.click(forward())
    expect(tabs.back).toHaveBeenCalledWith(tab.id)
    expect(tabs.forward).toHaveBeenCalledWith(tab.id)
    act(() => store.sleepCard(card.id))
    expect(back().disabled).toBe(true)
    expect(forward().disabled).toBe(true)
  })

  it('the reload button stops while loading, re-navigates on error, otherwise reloads', async () => {
    const { tab, tabs, onNavigate, apply } = await setup()
    apply({ loading: true })
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(tabs.stop).toHaveBeenCalledWith(tab.id)
    apply({ error: { code: -102, key: 'errors.refused' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(onNavigate).toHaveBeenCalledWith('https://a.test/')
    apply({})
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(tabs.reload).toHaveBeenCalledWith(tab.id)
  })

  it('card buttons sleep, maximize and close the card', async () => {
    const { store, card } = await setup()
    fireEvent.click(screen.getByTestId('maximize'))
    expect(card.isMaximized).toBe(true)
    fireEvent.click(screen.getByTestId('sleep-toggle'))
    expect(card.isSleeping).toBe(true)
    fireEvent.click(screen.getByTestId('sleep-toggle'))
    expect(card.isSleeping).toBe(false)
    fireEvent.click(screen.getByTestId('close-card'))
    expect(store.activeSpace!.visibleCards).toHaveLength(0)
  })

  it('labels are translated in Arabic', async () => {
    await setup('ar')
    for (const key of ['back', 'forward', 'reload'] as const) {
      expect(screen.getByRole('button', { name: ar.nav[key] })).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: ar.card.close })).toBeTruthy()
  })
})
