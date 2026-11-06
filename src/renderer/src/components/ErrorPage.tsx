import { useTranslation } from 'react-i18next'
import styles from './ErrorPage.module.css'

type Props = { messageKey: string; onRetry: () => void }

/** Plain-words load error, shown in the card body in place of the page. Never just a code. */
export function ErrorPage({ messageKey, onRetry }: Props) {
  const { t } = useTranslation()
  return (
    <div className={styles.error} role="alert" data-testid="error-page" data-error-key={messageKey}>
      <h2 className={styles.title}>{t('errors.title')}</h2>
      <p className={styles.message}>{t(messageKey)}</p>
      <button type="button" className={styles.retry} onClick={onRetry}>
        {t('errors.retry')}
      </button>
    </div>
  )
}
