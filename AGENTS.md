# AfterTouch Radio Browser — Agent Guide

## Commands
- **Dev server**: `npm start`
- **Test** (vitest, jsdom): `npm test`
- **Build**: `npm run build` (also writes `dist/app-assets.json` — the stable runtime manifest the Android Cordova wrapper fetches to inject the current hashed assets; ships automatically with every deploy)
- **Typecheck**: `npx tsc --noEmit --skipLibCheck` (`@types/node` not installed; `--skipLibCheck` required)
- **Deploy**: `npm run deploy` → `vite build && rimraf docs && mv dist docs` (wipes and regenerates `docs/`). GitHub Pages hosts from the `docs/` folder, so commit the regenerated `docs/` after every deploy. `dist/` and `.DS_Store` are gitignored.
- **Android wrapper**: the `cordova/` subproject (local Cordova CLI dep, no plugins) packages a native shell that loads the deployed assets via `dist/app-assets.json`. Run from `cordova/`: `npx cordova platform add android` (once), then from repo root `npm run android:build` / `npm run android`. Generated `platforms/`, `plugins/`, and `node_modules/` under `cordova/` are gitignored.

## Architecture
- **Full map**: `ARCHITECTURE.md` at repo root contains the complete structure/dependency map. Read it before major changes; **keep it in sync** (update it in the same commit) whenever the module structure or dependencies change.
- **Vanilla TypeScript SPA** — no framework. Vite bundler.
- **Entry**: `src/main.ts` → render app, wire events, fetch initial data.
- **Global mutable state** (`src/app.ts` → `state` export). Components read/write it directly.
- **Components** (`src/components/*.ts`): Pure functions returning HTML strings. No virtual DOM.
- **Event delegation**: All user interaction handled by 3 delegated listeners on `#app` (click, keydown, change) in `src/events.ts` — plus a single document-level Escape listener for the settings popup (bound once, inert while closed). No per-element `.addEventListener` bindings.
- **Audio widget**: Single persistent `<audio>` element from `player.ts`. `render()` in `app.ts` detaches it before `innerHTML`, then re-inserts into `.player`. Breaking this pattern kills audio playback.

## Key conventions
- **Component templates**: Multi-line template literals in component functions (`src/components/*.ts`, `App()` in `src/app.ts`) — one element per line, 4-space indent mirroring the DOM nesting; keep `${...}` interpolations on their tag's line and inline text runs that must stay adjacent (e.g. `<strong>…</strong><small>…</small>` in the player bar) unbroken. Single-element snippets (`playBtn`, `previewBtn`, `hint`, `msg`, `serviceLink`) and short single-tag returns (banner, footer) stay on one line. Newlines become part of the HTML but collapse as inter-element whitespace (flex/grid items, block boundaries) — no visual or test impact.
- **Language codes**: `en`, `de`, `ru`, `ukr` (not `uk`). `getLabels()` maps `'uk'` → `'ukr'`. The settings popup's Language select shows the fully written native names (English, Deutsch, Русский, Українська) for those codes.
- **Translations**: `as const` object in `i18n.ts`. Add new keys to all 4 languages when extending.
- **localStorage keys**: `radio-browser-language`, `radio-browser-soundtouch-host`, `radio-browser-favorites`, `radio-browser-settings`, `radio-browser-languages-cache`, `radio-browser-countries-cache`, `radio-browser-art-<uuid>` (per-station artwork URL, FR-6)
- **Settings** (2 toggles, stored as JSON): `enablePreview` (default off), `hideRemoteSkipButtons` (default on — hides the Remote panel's next/prev buttons). Defaults in `src/settings.ts`. The language control and the SoundTouch host config (input, save, live status, device info) live in the settings popup too — the host field is labeled `soundtouchNetworkAddress` ("SoundTouch network address", all 4 languages) above the input, the same title placement as the Language select; the Remote panel header repeats the ℹ device-info widget next to its connection status — in the popup the ℹ rows open upward clear of the host input, and the modal panel keeps its native scrolling (expanding the ℹ scrolls the rows into view); the language persists under `radio-browser-language`, the host under `radio-browser-soundtouch-host` (neither is part of the settings JSON); reset never touches either. The full-screen setup view is the only remaining user of the `#soundtouch`/`#saveSoundtouch` ids.
- **SoundTouch**: Reachability probes the device Web API — `GET http://<host>:8090/info` as a `no-cors` request (opaque response: it only proves the port answers; 5s timeout per attempt). Station send is `POST http://<host>:8090/select` (`no-cors`, `text/plain;charset=UTF-8` body). An explicit port in the saved host is honored (no `:8090` appended). Live state comes from the port-8080 WebSocket feed — `ws://<host>:8080/`, "gabbo" subprotocol, XML `<updates>` messages (`nowPlayingUpdated`, `volumeUpdated`; unknown/signal-only events keep the last-known state; the explicit-port rule applies there too). Transport/volume/mute commands are `no-cors` POSTs on 8090: `/key` press+release pairs with `sender="Gabbo"` and `/volume`. **No echo loops**: live device state (now playing, play status, volume, mute) is written only from WebSocket events, never from command POSTs or optimistic updates. On WS loss: keep last-known state, reconnect with capped exponential backoff, probe via `/info`; only repeated probe failures trigger the offline banner. Wire contracts are pinned in `API-NOTES.md`.
- **Git artifacts**: `docs/` is tracked (GitHub Pages hosting output — commit it after deploys); `dist/` and `.DS_Store` are gitignored.

## Testing notes
- Tests set up via `document.body.innerHTML = '<div id="app"></div>'` in `beforeEach`.
- Environment: jsdom (configured in `vite.config.ts`, `test.environment`).
- Global state (`state`) is shared across tests — reset relevant fields in `beforeEach`.
