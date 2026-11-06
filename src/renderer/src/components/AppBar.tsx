import { observer } from 'mobx-react-lite'
import { useTranslation } from 'react-i18next'
import owl from '../assets/nightshift-owl.svg'
import { useApp } from '../app-context'
import { PlusIcon } from './icons'
import styles from './AppBar.module.css'

export const AppBar = observer(function AppBar() {
  const { store } = useApp()
  const { t } = useTranslation()
  const next = store.ui.locale === 'en' ? 'ar' : 'en'
  return (
    <header className={styles.bar} data-testid="app-bar">
      <img className={styles.owl} src={owl} width={22} height={22} alt="" data-testid="owl" />
      <span className={styles.name}>NIGHTSHIFT</span>
      <div className={styles.spacer} />
      <button
        type="button" className={styles.action} data-testid="new-card"
        onClick={() => store.openCard({ url: 'about:blank', afterCardId: store.activeSpace?.activeCardId ?? undefined })}
      >
        <PlusIcon />
        <span>{t('appBar.newCard')}</span>
      </button>
      <button
        type="button" className={styles.action} data-testid="language-toggle" lang={next}
        aria-label={t('appBar.languageLabel')} onClick={() => store.setLocale(next)}
      >
        {t('appBar.language')}
      </button>
    </header>
  )
})
