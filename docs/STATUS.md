# NightShift Browser — project status

What works, what is planned, how it is tested, and the traps to know about. For the design see
[ARCHITECTURE.md](ARCHITECTURE.md).

## What works (phase P0)

- Frameless window with a React interface and one sandboxed native view per awake tab.
- Cards: open, close (soft delete), resize with a 300 px minimum (also from the keyboard), double-click the card
  chrome to maximize, sleep and wake. The active card has a sodium outline and becomes active only on real input in
  its page.
- Tabs inside a card: add, switch, close, reorder (model only). Closing the last tab closes the card.
- Omnibox: URL or search (`javascript:`, `file:` and similar are never opened). The search engine is a stored
  setting, Google by default.
- Back, forward, reload, stop. Plain-words error page in English and Arabic. Pop-ups and `target=_blank` open as a new
  card after the opener, rate-limited, never as a native window.
- Favicons, fetched by the main process (see ARCHITECTURE.md §8).
- English and Arabic with full RTL mirroring.
- Persistence with migrations (schema v3), per-record repair, recovery from a backup, soft-delete purge.
- Brand tokens and bundled fonts; no network requests from the interface.

## Planned

- Fast-scroll screenshot swap, overlay view for popovers (P1).
- Spaces and the spacebar, command palette, shortcuts, find in page, zoom, mute, settings UI, onboarding (P1).
- Sleep timer and saved screenshot while asleep; pinned-tab UI; profiles UI; applying the mute setting (P1/P2).
- Extensions, ad blocker, history, downloads, site permissions (P2).
- Installer, auto-update, encrypted backups (P3). AI features (P4).

## Tests

```
npm run typecheck
npm run lint
npm test                 # unit and component tests (Vitest; components run under happy-dom)
npm run test:cov         # with coverage; pure-logic modules are held to 80%+
npm run test:e2e         # builds in test mode, then drives the real app with Playwright
```

Latest run: typecheck, lint and build clean; 351 unit tests in 36 files; coverage 95.3% statements, 88.0% branches,
94.7% functions, 98.2% lines; 33 end-to-end tests. The Electron adapters (`electron-view-factory.ts`, `view-events.ts`,
`session-fetch.ts`, `session-hardening.ts`) need a real Electron runtime and are covered by the end-to-end tests
instead of unit coverage. End-to-end tests are hermetic: every host except loopback is blocked and pages come from a
local fixture server.

Not covered: a live bad-certificate site (the error mapping is unit-tested and an end-to-end test checks that no
certificate override exists).

## Running it

Node 22 or newer, npm. No native modules.

```
npm install
npm run dev              # app with hot reload
npm run dev:smoke        # starts the dev app over CDP and fails on any content-security-policy violation
npm run build            # production build into out/
```

If `node_modules/electron/dist` is missing after install, run `node node_modules/electron/install.js`.

Test-only switches (honoured only in builds made with `--mode e2e`, never when packaged): `NS_E2E=1` exposes the
`__nsTest` hooks and skips the single-instance quit; `NS_USER_DATA_DIR` sets the user-data folder;
`NS_E2E_DEBUG=1` streams the main process's stderr during Playwright runs. End-to-end tests must run against a build
made with `npm run build:e2e` (`npm run test:e2e` does this).

## Known traps

- **`View.setBounds` uses DIPs, not physical pixels.** Send `getBoundingClientRect()` rounded to integers. Never
  multiply by `devicePixelRatio`.
- **WebContentsView z-order is insertion order.** The shell is added first, so pages always paint above shell UI; popovers
  need the planned overlay view. A removed view's `webContents` is not destroyed automatically: always `close()` it.
- **titleBarOverlay in RTL.** Windows caption buttons stay on the physical right even with `dir=rtl`, so the app bar
  uses physical `padding-right`, not logical padding.
- **RTL and scroll.** The renderer sends already-mirrored physical rectangles. Chromium's RTL `scrollLeft` is 0 or
  negative; do not assume a positive value.
- **Stale navigation commits.** A new view's initial `about:blank` commit can arrive after `loadURL(x)` and overwrite the
  tab URL. `nav-state.ts` keeps `intended` and ignores commits until navigation to `x` has started.
- **View focus is not user intent.** Chromium focuses a view by itself when it loads. Activate a card on `input-event`
  (`mouseDown` / `touchStart`), never on `focus`.
- **Quit path.** `app.close()` and `app.quit()` go through `before-quit`, not the window `close` event, so the
  flush handshake lives in `before-quit`.
- **`session.fetch` with `redirect: 'manual'` throws** ("Redirect was cancelled"). Favicon fetching uses `net.request`
  with manual redirects instead.
- **Shell reload destroys tab views.** Views are destroyed when the shell starts loading its own URL again (not on
  commit, which can destroy views the new document already woke).
- **Synthetic drags in Playwright lose pointer capture** if a native view slides under the parked OS cursor mid-drag.
  Keep test drags to one or two large steps.
- **The sandboxed preload must be CommonJS.** `electron.vite.config.ts` forces it; do not add `"type": "module"`.
- **`fractional-indexing` is ESM-only**; it is used in the renderer and shared code, which electron-vite bundles.
- **zod runs without its JIT** in the renderer (`zod-config.ts`), because its eval probe would raise policy violations.
- **Vitest and jsdom:** jsdom's very slow cold load exceeds Vitest's 60 s worker-start limit on some machines, so
  component tests use happy-dom.

## Known limits

- A shell crash loses up to about 800 ms of unsaved edits (300 ms in the interface plus a 500 ms write delay). On
  Windows logoff or shutdown the quit flush may not run.
- Favicons add up to about 44 KB each to the state file; an origin-keyed cache is planned.
- A public name that resolves to a local address is not caught by the favicon host check.
- A second launch during startup is ignored.
- Electron fuses are not set yet (no packaging): RunAsNode off, NodeCliInspect off, OnlyLoadAppFromAsar on,
  EmbeddedAsarIntegrity on.
- The search engine setting can only be changed by editing the state file until the settings UI exists.
- One end-to-end test ("opens several cards") once reported 4 native views instead of 3 under heavy load; it did not
  reproduce in 8 stressed runs, and it now compares tab ids so a repeat names the extra view.

## Third-party assets

| Asset | Source | License |
|---|---|---|
| Bricolage Grotesque 500/700 | `@fontsource/bricolage-grotesque` | OFL-1.1 |
| IBM Plex Sans 400/500/600 | `@fontsource/ibm-plex-sans` | OFL-1.1 |
| IBM Plex Sans Arabic 400/500/600 | `@fontsource/ibm-plex-sans-arabic` | OFL-1.1 |
| IBM Plex Mono 400 | `@fontsource/ibm-plex-mono` | OFL-1.1 |
| `nightshift-owl.svg`, `resources/icon.png` | NightShift's own artwork | MIT, with the rest of the repository |
| UI icons (`components/icons.tsx`) | Hand-written inline SVG in this repository | MIT |

Main runtime libraries: electron, react, react-dom, mobx, mobx-state-tree, mobx-react-lite, zod, i18next,
react-i18next and framer-motion are MIT; fractional-indexing is CC0-1.0.
