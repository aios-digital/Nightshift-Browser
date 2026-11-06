import { join } from 'node:path'
import { BaseWindow, WebContentsView } from 'electron'
import { lockNavigation } from '../tabs/session-hardening'

export const NIGHT = '#0E1530'
export const APP_BAR_HEIGHT = 40
const MOON = '#E8ECF8'

export type ShellWindow = { window: BaseWindow; shell: WebContentsView }

export function createShellWindow(opts: { preloadPath: string; iconPath: string; appUrl: string }): ShellWindow {
  const window = new BaseWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: NIGHT,
    icon: opts.iconPath,
    title: 'NightShift',
    titleBarStyle: 'hidden',
    // Windows draws the caption buttons. They always stay on the physical right, even in RTL.
    titleBarOverlay: { color: NIGHT, symbolColor: MOON, height: APP_BAR_HEIGHT }
  })

  const shell = new WebContentsView({
    webPreferences: {
      preload: opts.preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      navigateOnDragDrop: false
    }
  })
  shell.setBackgroundColor(NIGHT)
  window.contentView.addChildView(shell) // added first: tab views stack above it

  const fit = () => {
    const [width, height] = window.getContentSize()
    shell.setBounds({ x: 0, y: 0, width: width ?? 0, height: height ?? 0 })
  }
  fit()
  for (const ev of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore'] as const) {
    window.on(ev as 'resize', fit)
  }

  shell.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  lockNavigation(shell.webContents)
  shell.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined)

  // Load exactly the URL the IPC guard trusts (loadFile would build it differently, e.g. for paths containing %).
  void shell.webContents.loadURL(opts.appUrl)

  shell.webContents.once('did-finish-load', () => window.show())
  return { window, shell }
}

export const preloadPathFrom = (dir: string) => join(dir, '../preload/index.js')
