# AfterTouch Radio Browser

AfterTouch Radio Browser is an app for searching radio stations and controlling them on a Bose
SoundTouch speaker from your phone. Stations come from the Radio Browser service
(https://www.radio-browser.info/) — a community-maintained catalog of internet radio stations.
Bose shut down the SoundTouch cloud on May 6, 2026, so the app is built for the aftermarket
software that keeps these speakers alive: [AfterTouch — Bose SoundTouch Toolkit]
(https://gesellix.github.io/Bose-SoundTouch/). Not affiliated with Bose Corporation.

Features shipped in this release and planned for the next are specified in
[FEATURES.md](FEATURES.md) — wave-1 features and the wave-2 live device-state remote (FR-3)
are implemented.

## SoundTouch remote control

The app turns your phone into a remote control for a Bose SoundTouch speaker on your network.
The speaker plays the radio; the phone picks what plays on it — and can preview stations in the
browser instead. The app connects straight to the speaker's own Web API — no account, cloud, or
service in the app itself. Live state from the speaker (now playing, volume, mute) and the
transport commands ship as the FR-3 live remote (see
[FEATURES.md](FEATURES.md)).

Because Bose shut down the SoundTouch cloud on May 6, 2026, the speaker must be migrated to
[AfterTouch](https://gesellix.github.io/Bose-SoundTouch/) with the **Radio Browser** source
active (AfterTouch Health tab) for stations to play. The app works with every AfterTouch
install path — on the speaker itself, on a local host (Raspberry Pi, NAS, PC), or on a VPS —
because it only ever talks to the speaker's own Web API, wherever AfterTouch runs.
Not affiliated with Bose Corporation.

### One-time setup

The app needs only the speaker's address — how AfterTouch is installed (on the speaker, on a
local host, or on a VPS) doesn't matter. Two things must be true first: the speaker is migrated
to AfterTouch, and the AfterTouch Health tab shows **Radio Browser** as active.

1. Find the speaker's IP address (e.g. in your router's device list).
2. When no speaker is configured, the app shows a full-screen setup view: enter the address and
   press **Save**. The app checks the speaker and shows ✓ Reachable (or ✗ Unreachable). You can
   also skip setup and browse stations first — the play-on-speaker action stays disabled until
   an address is saved.
3. The app remembers the speaker — setup is needed only once. The address stays editable in the
   compact SoundTouch bar on the main screen.

### Remote control

The FR-3 live remote (see [FEATURES.md](FEATURES.md)) keeps a WebSocket connection to the
speaker's state feed (port 8080) once configured and shows a **Remote** panel on the main
screen:

- **Now playing** — what's playing on the speaker (station/track, artist, source) and whether
  it's playing or paused, updated in real time.
- **Playback** — play/pause, next, and previous buttons.
- **Volume** — a slider that mirrors the speaker's actual volume and sends changes to it,
  plus a mute button.

If the connection drops (e.g. the phone leaves the home Wi-Fi), the panel keeps the last
known state and retries; if the speaker turns out to be unreachable, the offline banner
appears and the controls are disabled.

### Play stations on the speaker

- **Play on speaker** — the primary action on every station card sends the station straight to
  the speaker; favorites play to the speaker too. A confirmation ("Playing on speaker…") shows
  when the station was sent.
- **Preview instead (optional)** — with in-browser preview enabled in Settings, a Preview action
  on each card plays the station in the phone's browser without touching the speaker (see
  below).

### When the speaker is unreachable

The phone must be on the same Wi-Fi as the speaker. If it isn't (e.g. mobile data), the app
shows an offline banner and keeps the station list usable; the play-on-speaker action is
disabled until the phone is back on the home network.

If the speaker is reachable but a station won't play, the Radio Browser source is probably not
active on the speaker — check the AfterTouch Health tab (see the
[AfterTouch Radio Browser reference](https://gesellix.github.io/Bose-SoundTouch/docs/reference/radio-browser/)).

### Preview in the browser (optional)

By default the app is a remote and plays no audio itself. Enable **in-browser preview** in
Settings to add a Preview action to every station card and listen on the phone instead of the
speaker.

### Notes

- The app connects to the speaker directly: HTTP port 8090 — the device's Web API — for the
  reachability check (GET /info) and play commands (POST /select). The remote-control
  commands (POST /key, POST /volume) and the live-state WebSocket feed on port 8080 ship with
  the FR-3 live remote (see FEATURES.md).
- Chrome (and other Chromium browsers) may ask permission to *look for and connect to devices on
  your local network* — allow it for the app.
- The app is an installable PWA (web app manifest + icons, standalone window) with **no
  service worker**: the app is online-only, so there is no offline support and no update
  lifecycle — new releases reach you on the next visit. Install via the browser's own
  affordances: the address-bar Install icon in Chrome/Edge (desktop), the browser menu
  (Android), or the Share menu → "Add to Home Screen" (iOS).

## Quick start

Requirements: Node.js and npm.

```sh
npm install
npm start        # dev server (Vite)
npm test         # unit tests (Vitest + jsdom)
npm run build    # production build into dist/
npx tsc --noEmit --skipLibCheck   # typecheck
npm run deploy   # build, then replace docs/ with the build (GitHub Pages)
```

Notes:

- `--skipLibCheck` is required for the typecheck because `@types/node` is not installed.
- `docs/` is the GitHub Pages hosting output: `npm run deploy` wipes it and regenerates it from
  the build. Because this repo is hosted from the `docs/` folder, the generated files are kept
  **committed** — after every deploy, commit the regenerated `docs/`. Never edit `docs/` by hand.
  `dist/` and `.DS_Store` are gitignored.

## Architecture

A full codebase map — structure, key files, module dependency graph, and conventions — lives in
[ARCHITECTURE.md](ARCHITECTURE.md).

- **Vanilla TypeScript SPA** — no framework; Vite bundler.
- **Entry point** — `src/main.ts` renders the app, wires the event listeners, fetches the
  initial Top-voted list, and pings a saved SoundTouch host and opens its live-state
  WebSocket.
- **State** — global mutable state lives in `src/app.ts` (types in `src/state.ts`); components
  read and write it directly.
- **Components** — pure functions in `src/components/*.ts` that return HTML strings; no virtual
  DOM.
- **Event handling** — all user interaction is handled by three delegated listeners (click,
  keydown, change) on `#app` in `src/events.ts`.
- **Audio** — a single persistent `<audio>` element created in `src/player.ts`; `render()`
  detaches it before replacing the DOM and re-inserts it into `.player` afterwards (required for
  uninterrupted playback).
- **Data** — axios with base URL `https://de1.api.radio-browser.info/json`; endpoints
  `/stations/search` (name/country/language/tag, limit, hidebroken, sortable by name,
  popularity of the last day, 2-day trending, or all-time votes), `/stations/topvote`, and
  `/stations/lastclick`.
- **i18n** — translations are a `const` object in `src/i18n.ts` with all four languages;
  `getLabels()` falls back to English.

## Key conventions

- **Language codes** — `en`, `de`, `ru`, `ukr` (not `uk`); auto-detected from the browser on
  first run (`'uk'` → `'ukr'`, unsupported → English), manually overridable via the language
  chips; `getLabels()` maps `'uk'` → `'ukr'`, and `<html lang>` is set to `uk` for Ukrainian.
- **localStorage keys** — `radio-browser-language`, `radio-browser-soundtouch-host`,
  `radio-browser-favorites`, `radio-browser-settings` (settings stored as JSON; a single
  `enablePreview` toggle, default off; defaults in `src/settings.ts`), and
  `radio-browser-languages-cache` / `radio-browser-countries-cache` (raw JSON fallback copies of
  the last successful Language/Country dropdown option lists, used when the Radio Browser API
  fetch fails or returns empty).
- **SoundTouch ports** — 8090: the device Web API for the reachability check (GET `/info`),
  play commands (POST `/select`, `no-cors`, `text/plain;charset=UTF-8`, body is a
  `<ContentItem source="RADIO_BROWSER" type="stationurl" location="/stations/byuuid/{uuid}"/>`
  document), and the remote-control commands (POST `/key` — press+release pairs with
  `sender="Gabbo"` for play/pause/next/prev — and POST `/volume` for volume/mute). 8080: the
  live-state WebSocket feed (`ws://<host>:8080/`, "gabbo" protocol, XML `<updates>` messages:
  `nowPlayingUpdated`, `volumeUpdated`); live device state is written only from these events —
  no echo loops. The reachability check is a `no-cors` GET `/info` probe: stock Bose firmware
  answers with a fixed CORS allowlist that never matches the app's origin, so the response is
  opaque and "✓ Reachable" simply means the Web API answers on 8090. Each attempt aborts
  after 5s. An explicit port in the saved host is honored for both the Web API and the
  WebSocket (no `:8090`/`:8080` appended). The host input is sanitized
  before use (scheme, path, and unsafe characters stripped).
- **Status line** — shows "Loading stations…" during a fetch, "N loaded" on success, or
  "Service unavailable" on error. In Search and Favorites modes it appends the active sort
  label ("N loaded · Popular (1 day)").
- **Hosting** — GitHub Pages serves the app from the committed `docs/` folder; `dist/` and
  `.DS_Store` are gitignored.

## License

MIT — see [LICENSE](LICENSE).
