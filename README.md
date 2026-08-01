# AfterTouch Radio Browser

AfterTouch Radio Browser is an app for searching radio stations and listening to them on Bose
SoundTouch speakers or right in the browser. Stations come from the Radio Browser service
(https://www.radio-browser.info/) — a community-maintained catalog of internet radio stations.
Since the manufacturer no longer supports these speakers, the app is built for aftermarket
software: [AfterTouch — Bose SoundTouch Toolkit](https://gesellix.github.io/Bose-SoundTouch/).

## Listening on a Bose SoundTouch speaker

The app can send a station straight to a SoundTouch speaker on your network. Because Bose no
longer supports these speakers, this requires AfterTouch to be running on your network — the
local aftermarket service this app is built for (see the AfterTouch project page for
installation).

1. Find the speaker's IP address (e.g. in your router's device list).
2. In the app's header, enter the address into the **SoundTouch** field and press **Save**. The
   status icon next to the field shows the result: ✓ reachable, ✗ unreachable.
3. On a station card, press **Send to SoundTouch** to play the station on the speaker — or enable
   *Send to SoundTouch by default* in Settings so the play button always targets the speaker
   instead of the browser.

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
- **SoundTouch ports** — 8000: reachability check (HEAD, `no-cors`); 8090: send station (POST,
  `no-cors`, `text/plain;charset=UTF-8`, body is a
  `<ContentItem source="RADIO_BROWSER" type="stationurl" location="/stations/byuuid/{uuid}"/>`
  document). The host input is sanitized (scheme and trailing slash stripped).
- **Status line** — shows "Loading stations…" during a fetch, "N loaded" on success, or
  "Service unavailable" on error.
- **Hosting** — GitHub Pages serves the app from the committed `docs/` folder; `dist/` and
  `.DS_Store` are gitignored.

## License

MIT — see [LICENSE](LICENSE).
