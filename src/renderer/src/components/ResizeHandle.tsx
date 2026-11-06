import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { applyResizeDelta } from '../layout/geometry'
import styles from './ResizeHandle.module.css'

type Props = {
  width: number
  dir: 'ltr' | 'rtl'
  min: number
  max: number
  label: string
  onResize: (width: number) => void
}

const KEY_STEP = 40

/** Drag handle on a card's trailing edge. The trailing edge is the physical left in RTL, so the delta flips. */
export function ResizeHandle({ width, dir, min, max, label, onResize }: Props) {
  const start = useRef<{ x: number; width: number } | null>(null)

  const down = (e: PointerEvent<HTMLDivElement>) => {
    start.current = { x: e.clientX, width }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current
    if (s) onResize(applyResizeDelta(s.width, e.clientX - s.x, dir, min, max))
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    start.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') onResize(applyResizeDelta(width, KEY_STEP, dir, min, max))
    else if (e.key === 'ArrowLeft') onResize(applyResizeDelta(width, -KEY_STEP, dir, min, max))
  }

  return (
    <div
      className={styles.handle}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
    />
  )
}
