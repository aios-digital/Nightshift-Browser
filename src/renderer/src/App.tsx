import { observer } from 'mobx-react-lite'
import { useLayoutEffect } from 'react'
import { I18nextProvider } from 'react-i18next'
import type { i18n } from 'i18next'
import { AppBar } from './components/AppBar'
import { CardRow } from './components/CardRow'
import { AppContext, useApp, type AppContextValue } from './app-context'
import { dirFor } from './i18n'

const Shell = observer(function Shell({ i18n }: { i18n: i18n }) {
  const { store } = useApp()
  const locale = store.ui.locale

  // Language and direction apply to the whole document before paint.
  useLayoutEffect(() => {
    void i18n.changeLanguage(locale)
    document.documentElement.lang = locale
    document.documentElement.dir = dirFor(locale)
  }, [i18n, locale])

  return (
    <>
      <AppBar />
      <CardRow />
    </>
  )
})

export function App({ value, i18n }: { value: AppContextValue; i18n: i18n }) {
  return (
    <AppContext.Provider value={value}>
      <I18nextProvider i18n={i18n}>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Shell i18n={i18n} />
        </div>
      </I18nextProvider>
    </AppContext.Provider>
  )
}
