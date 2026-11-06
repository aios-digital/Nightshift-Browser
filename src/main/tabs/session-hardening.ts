import type { Session, WebContents } from 'electron'
import { isAllowedNavigation } from '@shared/url/navigation-policy'

const hardened = new WeakSet<Session>()

/**
 * Locks down a session once. Permissions are denied until the P2 permission UI exists.
 * Certificate errors are deliberately NOT handled: Electron's default rejects bad certificates, and
 * the load fails with a -2xx code that the page shows as a plain-words error.
 */
export function hardenSession(session: Session): void {
  if (hardened.has(session)) return
  hardened.add(session)
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
  session.setDevicePermissionHandler(() => false)
  session.on('will-download', (event) => event.preventDefault()) // downloads arrive in P2
  // No device pickers until there is UI to ask the user. Electron would otherwise pick a device itself.
  session.on('select-hid-device', (event, _details, callback) => {
    event.preventDefault()
    callback()
  })
  session.on('select-serial-port', (event, _ports, _wc, callback) => {
    event.preventDefault()
    callback('')
  })
  session.on('select-usb-device', (event, _details, callback) => {
    event.preventDefault()
    callback()
  })
}

/** The shell is a single-page app: it never navigates, so a dropped link or a bug cannot turn it into a web page. */
export function lockNavigation(contents: WebContents): void {
  const block = (event: { preventDefault: () => void }) => event.preventDefault()
  contents.on('will-navigate', block)
  contents.on('will-redirect', block)
  contents.on('will-frame-navigate', block)
}

/** Refuses Web Bluetooth device selection in a page until a chooser exists. */
export function refuseBluetooth(contents: WebContents): void {
  contents.on('select-bluetooth-device', (event, _devices, callback) => {
    event.preventDefault()
    callback('')
  })
}

/** Blocks navigations (including redirects) to anything but web pages. */
export function guardNavigation(contents: WebContents): void {
  const block = (event: { preventDefault: () => void }, url: string) => {
    if (!isAllowedNavigation(url)) event.preventDefault()
  }
  contents.on('will-navigate', block)
  contents.on('will-redirect', block)
}
