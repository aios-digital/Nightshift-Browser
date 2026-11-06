import { observer } from 'mobx-react-lite'
import { useTranslation } from 'react-i18next'
import { useApp } from '../app-context'
import { CardView } from './CardView'
import styles from './CardRow.module.css'

/** Horizontal row of cards. In RTL the browser's own flex direction puts card 0 at the right edge. */
export const CardRow = observer(function CardRow() {
  const { store } = useApp()
  const { t } = useTranslation()
  const cards = store.activeSpace?.visibleCards ?? []
  return (
    <main className={styles.row} data-testid="card-row">
      {cards.length === 0 ? (
        <div className={styles.empty}>
          <h2>{t('empty.title')}</h2>
          <button type="button" className={styles.open} onClick={() => store.openCard({ url: 'about:blank' })} data-testid="empty-open">
            {t('empty.action')}
          </button>
        </div>
      ) : (
        cards.map((card) => <CardView key={card.id} card={card} />)
      )}
    </main>
  )
})
