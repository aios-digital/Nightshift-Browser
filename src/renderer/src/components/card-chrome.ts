const NOT_CHROME = 'input, button, [role="separator"], [data-testid="card-body"]'

/** True when an event target is the card's own chrome, not a control or the page area. Double-click there maximizes. */
export function isChromeTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(NOT_CHROME) === null
}
