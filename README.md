# NightShift Browser

An AI-powered, open-source, free desktop browser. Pages live on **cards** in a horizontal row: open several side by
side, resize them, put them to sleep, and keep tabs inside each card. Built on Electron, with English and Arabic
(full right-to-left) from day one.

Licensed under the [MIT License](LICENSE). Free to use, change and share.

## Status

Early development. The browser shell is working and tested; the AI features are the next phase.

| Area | State |
|---|---|
| Card row: open, close, resize (300 px minimum), maximize, sleep and wake | Working |
| Tabs inside a card, omnibox (address or search), back, forward, reload, stop | Working |
| Pop-ups open as new cards, never as native windows | Working |
| English and Arabic with full RTL mirroring | Working |
| Saved state: cards, tabs, widths and language come back after a restart; damaged files are repaired or recovered from a backup | Working |
| Plain-words error pages (English and Arabic) | Working |
| Spaces, spacebar, command palette, shortcuts, find in page, settings | Planned (next phase) |
| Extensions, ad blocker, history, downloads, site permissions | Planned |
| **AI:** assistant card, natural-language command palette, agents that work visibly in a card and ask before they submit, pay or send, plus a readable log of what an agent did | Planned (design in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)) |

Details, tests and known limits: [docs/STATUS.md](docs/STATUS.md).

## Getting started

You need Node.js 22 or newer and npm.

```
npm install
npm run dev          # start the app with hot reload
npm run build        # production build into out/
npm test             # unit tests
npm run test:cov     # unit tests with coverage
npm run test:e2e     # build (test mode) and run the end-to-end tests
npm run typecheck
npm run lint
```

## How it is built

- **Electron** with one window, a React interface, and one sandboxed view per awake tab. Web pages get no preload
  script and no access to the app.
- **TypeScript** (strict), React 18, MobX-State-Tree, zod, i18next, Vite via electron-vite.
- The interface measures where each card's page area is and tells the main process, once per frame, where to place
  the page view. Layout stays in one place and mirrors correctly in right-to-left.
- Every message between the interface and the main process is validated with zod, and only the app's own window,
  showing the app's own page, may send privileged messages.
- Tests: Vitest for logic and components, Playwright (driving the real app) for end-to-end flows.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.

## Security

The app sandbox, context isolation and a strict content security policy are on. Certificate errors are never
overridden. Permission requests and device pickers are denied until the interface for them exists. Please report
security problems privately to the maintainers rather than in a public issue.

## Third-party software and assets

- Fonts, bundled through `@fontsource` under the SIL Open Font License 1.1: Bricolage Grotesque, IBM Plex Sans,
  IBM Plex Sans Arabic and IBM Plex Mono.
- Runtime libraries: Electron, React, MobX, MobX-State-Tree, zod, i18next and others under MIT; fractional-indexing
  under CC0-1.0. See `package.json` and `package-lock.json`.
- The NightShift owl mark is NightShift's own artwork.

## Contributing

Issues and pull requests are welcome. Please run `npm run typecheck`, `npm run lint`, `npm test` and
`npm run test:e2e` before opening a pull request, and write tests first for new logic. Functions stay under 50 lines,
and every interface string needs an English and an Arabic version.
