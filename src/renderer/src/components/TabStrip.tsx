import { observer } from 'mobx-react-lite'
import { useTranslation } from 'react-i18next'
import type { CardInstance, TabInstance } from '../store/root-store'
import { CloseIcon, PlusIcon } from './icons'
import styles from './TabStrip.module.css'

type Props = {
  card: CardInstance
  onSelect: (tabId: string) => void
  onClose: (tabId: string) => void
  onNew: () => void
}

function tabLabel(tab: TabInstance, fallback: string): string {
  if (tab.customName) return tab.customName
  if (tab.title) return tab.title
  try {
    return new URL(tab.url).hostname || fallback
  } catch {
    return fallback
  }
}

export const TabStrip = observer(function TabStrip({ card, onSelect, onClose, onNew }: Props) {
  const { t } = useTranslation()
  return (
    <div className={styles.strip} role="tablist" data-testid="tab-strip">
      {card.visibleTabs.map((tab) => {
        const active = tab.id === card.activeTab?.id
        const label = tabLabel(tab, t('tab.untitled'))
        return (
          <div key={tab.id} className={`${styles.tab} ${active ? styles.active : ''}`} data-testid="tab" data-tab-id={tab.id}>
            <button
              type="button" role="tab" aria-selected={active} className={styles.label} title={label}
              onClick={() => onSelect(tab.id)}
            >
              {tab.customEmoji ? <span aria-hidden="true">{tab.customEmoji}</span> : null}
              {tab.favicon ? <img className={styles.favicon} src={tab.favicon} alt="" width={14} height={14} /> : null}
              <span className={styles.text}>{label}</span>
            </button>
            <button type="button" className={styles.close} aria-label={t('tab.close')} onClick={() => onClose(tab.id)}>
              <CloseIcon />
            </button>
          </div>
        )
      })}
      <button type="button" className={styles.add} aria-label={t('tab.new')} onClick={onNew} data-testid="new-tab">
        <PlusIcon />
      </button>
    </div>
  )
})
