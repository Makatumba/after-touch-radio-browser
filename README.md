# AfterTouch Radio Browser

AfterTouch Radio Browser is an app for searching radio stations and controlling them on a Bose
SoundTouch speaker from your phone. Stations come from the Radio Browser service
(https://www.radio-browser.info/) — a community-maintained catalog of internet radio stations.
Bose shut down the SoundTouch cloud on May 6, 2026, so the app is built for the aftermarket
software that keeps these speakers alive: [AfterTouch — Bose SoundTouch Toolkit]
(https://gesellix.github.io/Bose-SoundTouch/). Not affiliated with Bose Corporation.

Planned features for the next release are specified in [FEATURES.md](FEATURES.md).

## SoundTouch remote control

The app turns your phone into a remote control for a Bose SoundTouch speaker on your network.
The speaker plays the radio; the phone shows what's playing and lets you control it. The app
connects straight to the speaker's own Web API — no account, cloud, or service in the app
itself.

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
2. When no speaker is configured, the app shows a setup view: enter the address and press
   **Save**. The app checks the speaker and shows ✓ reachable (or ✗ unreachable).
3. The app remembers the speaker — setup is needed only once.

### Control from the phone

- **Play any station on the speaker** — the play action on a station card targets the speaker;
  favorites play straight to the speaker too.
- **See what's playing** — track, artist, and source, updated live from the speaker.
- **Control playback** — play/pause, next/previous.
- **Adjust volume** — slider and mute, always in sync with the speaker.
- **Lock-screen controls** — while connected, your phone's lock screen shows what's playing and
  offers play/pause/next/previous (on supported browsers).

### When the speaker is unreachable

The phone must be on the same Wi-Fi as the speaker. If it isn't (e.g. mobile data), the app
shows a notice and keeps the station list usable; speaker controls are disabled until the phone
is back on the home network.

If the speaker is reachable but a station won't play, the Radio Browser source is probably not
active on the speaker — check the AfterTouch Health tab (see the
[AfterTouch Radio Browser reference](https://gesellix.github.io/Bose-SoundTouch/docs/reference/radio-browser/)).

### Preview in the browser (optional)

By default the app is a remote and plays no audio itself. Enable **Preview in browser** in
Settings to listen on the phone instead of the speaker.

### Notes

- The app connects to the speaker directly: WebSocket port 8080 for live state updates, HTTP
  port 8090 for commands, port 8000 for the reachability check.
- Chrome (and other Chromium browsers) may ask permission to *look for and connect to devices on
  your local network* — allow it for the app.
- Remote control works from a browser on the same network; installed as a PWA, the app opens
  full-screen from your home screen.

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
  initial Top-voted list, and pings a saved SoundTouch host.
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
  `/stations/search` (name/country/language/tag, limit, hidebroken, clickcount order),
  `/stations/topvote`, and `/stations/lastclick`.
- **i18n** — translations are a `const` object in `src/i18n.ts` with all four languages;
  `getLabels()` falls back to English.

## Key conventions

- **Language codes** — `en`, `de`, `ru`, `ukr` (not `uk`); `getLabels()` maps `'uk'` → `'ukr'`,
  and `<html lang>` is set to `uk` for Ukrainian.
- **localStorage keys** — `radio-browser-language`, `radio-browser-soundtouch-host`,
  `radio-browser-favorites`, `radio-browser-settings` (settings stored as JSON; defaults in
  `src/settings.ts`).
- **SoundTouch ports** — 8000: reachability check (HEAD, `no-cors`); 8090: commands (POST,
  `no-cors`, `text/plain;charset=UTF-8`, body is a
  `<ContentItem source="RADIO_BROWSER" type="stationurl" location="/stations/byuuid/{uuid}"/>`
  document); 8080: WebSocket live state ("gabbo" protocol). The host input is sanitized (scheme
  and trailing slash stripped).
- **Status line** — shows "Loading stations…" during a fetch, "N loaded" on success, or
  "Service unavailable" on error.
- **Hosting** — GitHub Pages serves the app from the committed `docs/` folder; `dist/` and
  `.DS_Store` are gitignored.

## License

MIT — see [LICENSE](LICENSE).
