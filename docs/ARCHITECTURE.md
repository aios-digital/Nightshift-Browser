# NightShift Browser — Architecture

NightShift is an AI-powered, open-source desktop browser built around **cards**: pages sit side by side in a
horizontal row, and each card holds its own tabs.

## 1. Overview

- Electron app on stock Electron, with React 18 and MobX-State-Tree for the interface.
- Each awake tab is one native view. The interface decides where each card's page area is; the main process places
  the views there.
- **Data model:** Space → Stack → Card → Tab, plus Profile (its own cookie partition). Ordering uses fractional
  indexing, so reordering touches one item.
- **Today:** a row of resizable cards (300 px minimum, double-click to maximize), tabs inside a card, an omnibox
  (address or search), back/forward/reload, sleep and wake, pop-ups opening as new cards, English and Arabic with
  right-to-left layout, and saved state that survives restarts and damaged files.

## 2. Architecture

Stock Electron, `BaseWindow` + `WebContentsView`.

- `ShellView`: the React interface, filling the window.
- One `WebContentsView` per awake tab, in the session partition of the tab's profile. Web pages get no preload
  script, run sandboxed, and cannot reach the app.
- **The renderer owns layout and horizontal scroll.** Each card is a DOM placeholder. A `ResizeObserver` and a
  scroll listener batch the rectangles once per animation frame and send them over IPC (`views:set-layout`). The main
  process calls `setBounds` and `setVisible`.
- Rectangles are **physical, already-mirrored, integer DIPs** (`View.setBounds` takes DIPs, not device pixels), so
  the main process needs no right-to-left logic. This is checked by an end-to-end test at 150% display scale.
- **Planned:** during fast scrolling, show each card's last `capturePage()` screenshot and restore the live view
  about 120 ms after scrolling stops; a transparent overlay view for popovers.

## 3. Target stack

| Area | Choice |
|---|---|
| Build | electron-vite, TypeScript (strict) |
| Interface | React 18, MobX-State-Tree, CSS variables and CSS Modules |
| Ordering | fractional-indexing |
| Validation | zod, on every IPC payload in the main process |
| i18n | i18next + react-i18next, English and Arabic, RTL |
| Fonts | `@fontsource`: Bricolage Grotesque, IBM Plex Sans, IBM Plex Sans Arabic, IBM Plex Mono. Bundled; nothing loads from the network |
| Tests | Vitest (logic, components in happy-dom), Playwright driving the real app |
| Packaging | electron-builder, Windows first (not set up yet) |
| Storage (later) | SQLite for history, favicons and permissions |

## 4. Data model

```
Root   { spaces, profiles, ui, flags, schemaVersion }
Space  { id, index, name, emoji, defaultProfileId, stacks, activeCardId, isArchived, lastActiveAt }
Stack  { id, index, cards }
Card   { id, index, kind, width, isMaximized, isSleeping, profileId, soundMuted, isDeleted, deletedAt,
         createdAt, lastActiveAt, tabs, activeTabId, pinnedTabId }
Tab    { id, index, url, title, favicon, customName, customEmoji, isDeleted, openerTabId, createdAt }
Tab (not saved): loading, canGoBack, canGoForward, errorText
Profile{ id, name }          the session partition is derived as persist:profile-<id>
```

- `index` is a fractional-indexing key.
- **Schema version 3.** v2 added `Card.kind` (`'web'`, reserved for an assistant card) and `Card.isSleeping`; v3 stores
  favicons only as small image data URLs fetched by the main process. Migrations are ordered, pure, and tested
  against fixtures.
- **Soft delete:** `isDeleted` plus `deletedAt`. Deleted cards older than 30 days are purged on load and save, at
  most 100 deleted cards per stack and 50 deleted tabs per card are kept, and closed items keep no favicon. Live
  items are never purged.
- **Page-controlled values are bounded before they enter the model** (title ≤ 512, URL ≤ 8192, web URLs only, no
  `user:pass@`), so a page can never produce a state that cannot be saved. If a snapshot is still invalid, the save
  repairs it instead of failing.
- **Persistence:** the main process owns a JSON file; the renderer sends snapshots, the main process debounces and
  writes atomically (temp file, then rename, keeping the previous file as `.bak`).
- **Recovery:** on load, individual bad records are repaired or dropped rather than discarding the whole file. If
  `state.json` is unusable it is moved aside and the `.bak` is used. An unreadable (locked) file blocks saving for the
  session instead of risking an overwrite. Old backups are pruned.

## 5. Process model

```
Main process
  BaseWindow (frameless, title bar overlay on Windows)
  ├─ ShellView        React interface, preload: a small typed contextBridge API
  ├─ Tab views        one per awake tab, sandboxed, no preload
  ├─ Store service    JSON persistence, migrations, repair, recovery
  └─ IPC              zod-validated, sender-checked
Renderer (ShellView)
  MobX store · layout engine (rectangles per frame) · card row · omnibox · i18n
```

IPC channels: `views:set-layout`, `tabs:navigate`, `tabs:back|forward|reload|stop`, `tabs:wake|sleep|close-view`,
`store:load`, `store:save`, `shell:flush-done`; main to renderer: `tabs:state`, `tabs:open-request`, `tabs:focus`,
`shell:flush-request`.

## 6. Feature map by phase

**P0 — Shell (done).** Frameless window, per-tab views, data model, persistence with migrations, card row, tabs,
omnibox, navigation, sleep/wake, plain-words errors, favicons, English/Arabic with RTL, hardened security baseline.

**P1 — Core experience.** Spaces and stacks with a spacebar (drag and drop, badges); pinned primary tab; overview of
all cards; keyboard-only card navigation; command palette and quick switcher; shortcuts; find in page; zoom; mute;
Do Not Disturb; screenshot placeholders during fast scroll; link hover preview; overlay view; settings; onboarding.

**P2 — Browser plumbing.** Extensions, ad blocker, history, downloads, site permissions, context menu, profiles UI.

**P3 — Services.** Encrypted backups (per-install key in the OS credential store), auto-update, optional sign-in,
opt-in telemetry.

**P4 — AI.** See section 9.

## 7. Design tokens

`src/renderer/src/styles/tokens.css`

| Token | Value | Use |
|---|---|---|
| `--ns-night` | #0E1530 | background |
| `--ns-night-deep` | #0A1026 | spacebar, wells |
| `--ns-dusk` | #18224A | card chrome, panels |
| `--ns-dusk-raised` | #1F2B5A | hover, active tab |
| `--ns-line` | #2B3870 | borders |
| `--ns-moon` | #E8ECF8 | text |
| `--ns-haze` | #8F9BC6 | secondary text |
| `--ns-haze-dim` | #6873A1 | tertiary text |
| `--ns-owl` | #E47591 | logo only |
| `--ns-sodium` | #FFB547 | focus ring, active card outline, loading |

Status colours, one meaning each: running #FFB547 · needs you #FF8FA3 · done #7FD4C1 · failed #FF6B5B.
Radius 6 px for controls and 12 px for cards. Motion 120 / 180 / 250 ms, ease-out, never bouncy. The owl mark is 22 px
in the app bar and never smaller. Voice: plain and short; errors in plain words, never a code alone. Every string
exists in English and Arabic. With `dir="rtl"` the card row, tab strip and arrows mirror, card 0 sits at the right
edge, and URLs stay left-to-right.

## 8. Security baseline

- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, a minimal typed preload API.
- Every IPC payload is validated with zod. Only the shell's main frame, and only while it shows the app's own page,
  may call privileged channels.
- Tab views get no preload. Navigation is limited to `http(s)` and `about:blank`, with no embedded credentials.
- The shell never navigates (navigation and drag-and-drop are blocked). Pop-ups are rate-limited per page.
- Certificate checks are never disabled; certificate errors show a plain-words page.
- Permission requests, client certificates and HID/serial/USB/Bluetooth pickers are denied until there is interface
  for them.
- No secrets in code; telemetry is opt-in; backups use a per-install random key.
- Favicons are fetched by the main process through the tab's own session, limited in size and dimensions, checked by
  type and content, with every redirect hop checked and no requests from public pages to local-network hosts. The
  shell only ever receives `data:` images, and its policy is `img-src 'self' data:`.
- The test hooks used by the end-to-end tests exist only in builds made with `--mode e2e`.
- Listener cleanup uses `off`; every subscription returns a disposer.
- Still to do when packaging lands: Electron fuses (RunAsNode off, NodeCliInspect off, OnlyLoadAppFromAsar on,
  EmbeddedAsarIntegrity on).

## 9. AI (design)

- **Assistant card:** a card type whose content is NightShift interface, not a web page (`Card.kind` is reserved).
- **Palette AI:** the command palette accepts natural language and routes it to actions.
- **Agent runs in cards:** an agent drives a normal tab in a card, visibly. **Approval is required before it submits,
  pays or sends.**
- **Night log:** an append-only record of what an agent did, per run, readable by the user.

P0 leaves seams for these: the reserved `Card.kind`, an automation boundary on the tab manager, and
capability-scoped IPC.

## 10. Decisions

- Windows first; the code stays cross-platform.
- Stock Electron.
- Open until P3: sign-in and update hosting.
