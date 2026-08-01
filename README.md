# AfterTouch Radio Browser

A lightweight single-page app for searching, filtering, previewing, and playing internet radio
stations, built with vanilla TypeScript and Vite. Station data comes from the
[Radio Browser API](https://www.radio-browser.info/).

## Features

- **Search & filters** — filter stations by name, country, language, or tag; choose a result
  limit (12 / 24 / 50 / 100); hide broken stations; Search and Reset buttons; pressing Enter in
  any filter field triggers a search. Results are ordered by click count (descending).
- **Browse modes** — Top voted, Recently clicked, and Favorites. The Previous / Next result-set
  buttons cycle through Top → Recent → Search → Favorites (and back); entering Search mode grows
  the limit by 24 (up to 100) and leaving it shrinks it back (down to 12).
- **Player** — a single persistent audio element in a player bar showing the current station and
  its metadata (country · language · codec · bitrate). Playback uses the station's resolved URL,
  falling back to its raw URL.
- **Favorites** — toggle any station as a favorite from its card; favorites persist in
  `localStorage` and appear in the Favorites mode.
- **SoundTouch integration** — configure your Bose SoundTouch host; the app checks reachability
  (HEAD on port 8000) and can send a station to the speaker (POST on port 8090).
- **Settings** — modal with three toggles: disable the player bar, hide play buttons on station
  cards, or make the play button send to SoundTouch by default. A "Reset to defaults" button
  restores the defaults.
- **Internationalization** — interface in English, German, Russian, and Ukrainian, switchable via
  header chips and persisted across sessions.

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
