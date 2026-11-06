import { observer } from 'mobx-react-lite'
import { useTranslation } from 'react-i18next'
import { useApp } from '../app-context'
import { dirFor } from '../i18n'
import type { CardInstance } from '../store/root-store'
import { MIN_CARD_WIDTH } from '@shared/model/persisted-schema'
import { CardBody } from './CardBody'
import { CardNavBar } from './CardNavBar'
import { isChromeTarget } from './card-chrome'
import { ResizeHandle } from './ResizeHandle'
import { TabStrip } from './TabStrip'
import { useCardLayout } from './use-card-layout'
import styles from './CardView.module.css'

export const CardView = observer(function CardView({ card }: { card: CardInstance }) {
  const { store, api } = useApp()
  const { t } = useTranslation()
  const tab = card.activeTab
  const active = store.activeSpace?.activeCardId === card.id
  const { rootRef, bodyRef } = useCardLayout(card, tab?.id, tab?.errorText ?? null, active)
  if (!tab) return null

  const navigate = (url: string) => {
    // The model refuses URLs main would refuse (too long, not a web URL), so the two never disagree.
    if (store.navigateTab(tab.id, url)) api.tabs.navigate({ tabId: tab.id, url })
  }

  return (
    <section
      ref={rootRef}
      className={`${styles.card} ${active ? styles.active : ''}`}
      style={{ width: card.isMaximized ? '100%' : card.width }}
      data-testid="card" data-card-id={card.id} data-active={active} data-maximized={card.isMaximized}
      data-sleeping={card.isSleeping} data-width={card.width}
      onPointerDownCapture={() => store.setActiveCard(card.id)}
      onDoubleClick={(e) => isChromeTarget(e.target) && store.toggleMaximize(card.id)}
    >
      <CardNavBar card={card} tab={tab} active={active} onNavigate={navigate} />
      <TabStrip
        card={card}
        onSelect={(id) => store.setActiveTab(card.id, id)}
        onClose={(id) => store.closeTab(card.id, id)}
        onNew={() => store.addTab(card.id, 'about:blank')}
      />
      <CardBody card={card} tab={tab} bodyRef={bodyRef} onRetry={() => navigate(tab.url)} />
      <ResizeHandle
        width={card.width} dir={dirFor(store.ui.locale)} min={MIN_CARD_WIDTH} max={Math.max(MIN_CARD_WIDTH, window.innerWidth * 2)}
        label={t('card.resize')} onResize={(w) => store.resizeCard(card.id, w, window.innerWidth * 2)}
      />
    </section>
  )
})
