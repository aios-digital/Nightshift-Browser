import { observer } from 'mobx-react-lite'
import { useTranslation } from 'react-i18next'
import { useApp } from '../app-context'
import type { CardInstance, TabInstance } from '../store/root-store'
import {
  BackIcon, CloseIcon, ForwardIcon, MaximizeIcon, ReloadIcon, RestoreIcon, SleepIcon, StopIcon
} from './icons'
import { Omnibox } from './Omnibox'
import styles from './CardView.module.css'

type Props = { card: CardInstance; tab: TabInstance; active: boolean; onNavigate: (url: string) => void }

/** The card's top bar: back, forward, reload or stop, the omnibox, then sleep, maximize and close. */
export const CardNavBar = observer(function CardNavBar({ card, tab, active, onNavigate }: Props) {
  const { store, api } = useApp()
  const { t } = useTranslation()
  const asleep = card.isSleeping
  const reloadOrStop = () => {
    if (tab.loading) api.tabs.stop(tab.id)
    else if (tab.errorText) onNavigate(tab.url)
    else api.tabs.reload(tab.id)
  }

  return (
    <div className={styles.bar}>
      <button type="button" className={styles.btn} aria-label={t('nav.back')} disabled={!tab.canGoBack || asleep}
        onClick={() => api.tabs.back(tab.id)}><BackIcon /></button>
      <button type="button" className={styles.btn} aria-label={t('nav.forward')} disabled={!tab.canGoForward || asleep}
        onClick={() => api.tabs.forward(tab.id)}><ForwardIcon /></button>
      <button type="button" className={styles.btn} disabled={asleep}
        aria-label={tab.loading ? t('nav.stop') : t('nav.reload')} onClick={reloadOrStop}>
        {tab.loading ? <StopIcon /> : <ReloadIcon />}
      </button>
      <Omnibox
        url={tab.url} searchTemplate={store.ui.searchEngine} label={t('omnibox.label')}
        placeholder={t('omnibox.placeholder')} autoFocus={active && tab.url === 'about:blank'} onSubmit={onNavigate}
      />
      <button type="button" className={styles.btn} aria-label={asleep ? t('card.wake') : t('card.sleep')}
        onClick={() => (asleep ? store.wakeCard(card.id) : store.sleepCard(card.id))}
        data-testid="sleep-toggle"><SleepIcon /></button>
      <button type="button" className={styles.btn} aria-label={card.isMaximized ? t('card.restore') : t('card.maximize')}
        onClick={() => store.toggleMaximize(card.id)} data-testid="maximize">
        {card.isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>
      <button type="button" className={styles.btn} aria-label={t('card.close')} onClick={() => store.closeCard(card.id)}
        data-testid="close-card"><CloseIcon /></button>
    </div>
  )
})
