export type LoadErrorKey =
  | 'errors.dns'
  | 'errors.refused'
  | 'errors.timeout'
  | 'errors.offline'
  | 'errors.cert'
  | 'errors.generic'

const ERR_ABORTED = -3

/** Maps a Chromium net error code to an i18n key. Returns null for aborted loads (the user navigated away). */
export function describeLoadError(code: number): LoadErrorKey | null {
  if (code === ERR_ABORTED) return null
  if (code <= -200 && code >= -299) return 'errors.cert'
  switch (code) {
    case -105:
      return 'errors.dns'
    case -102:
      return 'errors.refused'
    case -7:
    case -118:
      return 'errors.timeout'
    case -106:
    case -109:
      return 'errors.offline'
    default:
      return 'errors.generic'
  }
}
