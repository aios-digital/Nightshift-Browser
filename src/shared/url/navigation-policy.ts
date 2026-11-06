/** Only web pages and about:blank may be loaded into a tab view. */
export function isAllowedNavigation(rawUrl: string): boolean {
  if (rawUrl === 'about:blank') return true
  try {
    const { protocol, username, password } = new URL(rawUrl)
    // user:pass@host URLs are a phishing tool ("https://bank.com@evil.example/"), so they are never loaded.
    return (protocol === 'http:' || protocol === 'https:') && username === '' && password === ''
  } catch {
    return false
  }
}
