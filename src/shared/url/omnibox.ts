export const DEFAULT_SEARCH_TEMPLATE = 'https://www.google.com/search?q=%s'

export type OmniboxResult = { kind: 'url' | 'search'; url: string }

const LABEL = String.raw`[\p{L}\p{N}\p{M}-]+`
const HOST_LIKE = new RegExp(
  String.raw`^(localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]+\]|${LABEL}(?:\.${LABEL})+)(:\d{1,5})?([/?#].*)?$`,
  'iu'
)
const HAS_WHITESPACE = /\s/u

function search(query: string, template: string): OmniboxResult | null {
  const q = query.trim()
  if (!q) return null
  const safe = template.includes('%s') ? template : DEFAULT_SEARCH_TEMPLATE
  return { kind: 'search', url: safe.replace('%s', encodeURIComponent(q)) }
}

function toUrl(candidate: string): string | null {
  try {
    return new URL(candidate).toString()
  } catch {
    return null
  }
}

/** Decide whether omnibox text is a URL to open or a search query. Never returns a non-web scheme as a URL. */
export function resolveInput(text: string, searchTemplate: string): OmniboxResult | null {
  const t = text.trim()
  if (!t) return null
  if (t.startsWith('?')) return search(t.slice(1), searchTemplate)
  if (t.toLowerCase() === 'about:blank') return { kind: 'url', url: 'about:blank' }

  if (/^https?:\/\//i.test(t) && !HAS_WHITESPACE.test(t)) {
    const url = toUrl(t)
    if (url) return { kind: 'url', url }
  }

  if (!HAS_WHITESPACE.test(t)) {
    const m = HOST_LIKE.exec(t)
    if (m) {
      const host = m[1] ?? ''
      const local = /^(localhost|\d|\[)/i.test(host)
      const url = toUrl(`${local ? 'http' : 'https'}://${t}`)
      if (url) return { kind: 'url', url }
    }
  }
  return search(t, searchTemplate)
}
