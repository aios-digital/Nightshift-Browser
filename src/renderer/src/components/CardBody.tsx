import { observer } from 'mobx-react-lite'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../app-context'
import type { CardInstance, TabInstance } from '../store/root-store'
import { ErrorPage } from './ErrorPage'
import styles from './CardView.module.css'

type Props = { card: CardInstance; tab: TabInstance; bodyRef: RefObject<HTMLDivElement>; onRetry: () => void }

/**
 * The page area. Main places the tab's native view exactly over this element; it only shows its own content
 * while the card sleeps or the page failed to load (the native view is hidden then).
 */
export const CardBody = observer(function CardBody({ card, tab, bodyRef, onRetry }: Props) {
  const { store } = useApp()
  const { t } = useTranslation()
  return (
    <div className={styles.frame}>
      <div ref={bodyRef} className={styles.body} data-testid="card-body" data-tab-id={tab.id} data-url={tab.url} data-loading={tab.loading}>
        {card.isSleeping ? (
          <div className={styles.sleeping} data-testid="sleeping">
            <p>{t('card.sleeping')}</p>
            <button type="button" className={styles.wake} onClick={() => store.wakeCard(card.id)}>{t('card.wake')}</button>
          </div>
        ) : tab.errorText ? (
          <ErrorPage messageKey={tab.errorText} onRetry={onRetry} />
        ) : null}
      </div>
    </div>
  )
})
