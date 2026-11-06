import type { NsApi } from '../../preload/api'

declare global {
  interface Window {
    ns: NsApi
  }
}
