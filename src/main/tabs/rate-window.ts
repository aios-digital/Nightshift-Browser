/**
 * Sliding-window rate limit. `history` holds the times of earlier allowed events; it is never mutated.
 * Returns whether one more event is allowed now, and the history to keep (expired entries dropped).
 */
export function allowInWindow(
  history: readonly number[],
  now: number,
  limit: number,
  windowMs: number
): { allowed: boolean; history: readonly number[] } {
  const recent = history.filter((at) => now - at < windowMs)
  if (recent.length >= limit) return { allowed: false, history: recent }
  return { allowed: true, history: [...recent, now] }
}
