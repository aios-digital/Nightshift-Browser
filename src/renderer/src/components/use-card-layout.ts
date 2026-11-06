import { useEffect, useRef } from 'react'
import { useApp } from '../app-context'
import type { CardInstance } from '../store/root-store'

/**
 * Keeps the card's native view in step with its DOM: registers the page area with layout sync, asks for a new
 * layout when the size or error state changes, and scrolls the active card into view.
 */
export function useCardLayout(card: CardInstance, tabId: string | undefined, errorText: string | null, active: boolean) {
  const { layoutSync } = useApp()
  const rootRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (card.isSleeping || !tabId || !bodyRef.current) return
    return layoutSync.register(tabId, bodyRef.current)
  }, [card.isSleeping, tabId, layoutSync])

  useEffect(() => {
    layoutSync.schedule()
  }, [errorText, card.isMaximized, card.width, layoutSync])

  useEffect(() => {
    if (active) rootRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [active, card.isMaximized])

  return { rootRef, bodyRef }
}
