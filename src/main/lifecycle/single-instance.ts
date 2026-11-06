export type FocusableWindow = {
  isDestroyed(): boolean
  isMinimized(): boolean
  isVisible(): boolean
  restore(): void
  show(): void
  focus(): void
}

/** A second launch hands over to the running app: bring its window back and to the front. */
export function focusExistingWindow(win: FocusableWindow | null): void {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  else if (!win.isVisible()) win.show()
  win.focus()
}
