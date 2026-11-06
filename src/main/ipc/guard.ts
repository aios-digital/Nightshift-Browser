import type { ZodType } from 'zod'

type SenderLike = { mainFrame: unknown }
type EventLike = { sender: unknown; senderFrame: unknown }

/** The URL without query or hash, normalised by the URL parser (so `http://host:1` equals `http://host:1/`). */
function baseHref(url: string): string | null {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    return null
  }
}

/** True when two URLs point at the same document, ignoring query and hash. Unparseable URLs never match. */
export function sameAppUrl(a: string, b: string): boolean {
  const left = baseHref(a)
  return left !== null && left === baseHref(b)
}

/**
 * True only when the message came from the ShellView's main frame AND that frame is still showing the app.
 * Tab views, sub-frames, and a shell that somehow navigated to a web page are never trusted.
 */
export function isShellEvent(event: EventLike, shell: SenderLike, appUrl: string): boolean {
  const frame = event.senderFrame as { url?: unknown } | null
  if (event.sender !== shell || frame == null || frame !== shell.mainFrame) return false
  return typeof frame.url === 'string' && sameAppUrl(frame.url, appUrl)
}

/**
 * Wraps an IPC handler: checks the sender, validates the payload with zod, and contains handler errors.
 * A rejected message is reported through `onReject` and answered with `undefined`; it never throws into Electron.
 */
export function guardHandler<S extends ZodType, R>(opts: {
  schema: S
  isTrusted: (event: unknown) => boolean
  fn: (payload: S['_output']) => R
  onReject: (reason: string) => void
}): (event: unknown, raw: unknown) => R | undefined {
  return (event, raw) => {
    if (!opts.isTrusted(event)) {
      opts.onReject('untrusted sender')
      return undefined
    }
    const parsed = opts.schema.safeParse(raw)
    if (!parsed.success) {
      opts.onReject(`invalid payload: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
      return undefined
    }
    try {
      return opts.fn(parsed.data)
    } catch (error) {
      opts.onReject(`handler failed: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }
}
