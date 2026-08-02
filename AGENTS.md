# AfterTouch Radio Browser — Agent Guide

## Commands
- **Dev server**: `npm start`
- **Test** (vitest, jsdom): `npm test`
- **Build**: `npm run build`
- **Typecheck**: `npx tsc --noEmit --skipLibCheck` (`@types/node` not installed; `--skipLibCheck` required)
- **Deploy**: `npm run deploy` → `vite build && rimraf docs && mv dist docs` (wipes and regenerates `docs/`). GitHub Pages hosts from the `docs/` folder, so commit the regenerated `docs/` after every deploy. `dist/` and `.DS_Store` are gitignored.

## Architecture
- **Full map**: `ARCHITECTURE.md` at repo root contains the complete structure/dependency map. Read it before major changes; **keep it in sync** (update it in the same commit) whenever the module structure or dependencies change.
- **Vanilla TypeScript SPA** — no framework. Vite bundler.
- **Entry**: `src/main.ts` → render app, wire events, fetch initial data.
- **Global mutable state** (`src/app.ts` → `state` export). Components read/write it directly.
- **Components** (`src/components/*.ts`): Pure functions returning HTML strings. No virtual DOM.
- **Event delegation**: All user interaction handled by 3 listeners on `#app` (click, keydown, change) in `src/events.ts`. No per-element `.addEventListener` bindings.
- **Audio widget**: Single persistent `<audio>` element from `player.ts`. `render()` in `app.ts` detaches it before `innerHTML`, then re-inserts into `.player`. Breaking this pattern kills audio playback.

## Key conventions
- **Language codes**: `en`, `de`, `ru`, `ukr` (not `uk`). `getLabels()` maps `'uk'` → `'ukr'`.
- **Translations**: `as const` object in `i18n.ts`. Add new keys to all 4 languages when extending.
- **localStorage keys**: `radio-browser-language`, `radio-browser-soundtouch-host`, `radio-browser-favorites`, `radio-browser-settings`
- **Settings** (1 toggle, stored as JSON): `enablePreview` (default off). Defaults in `src/settings.ts`.
- **SoundTouch**: Port 8000 for reachability (HEAD, `no-cors`), port 8090 for station send (POST, `no-cors`, `text/plain;charset=UTF-8` body).
- **Git artifacts**: `docs/` is tracked (GitHub Pages hosting output — commit it after deploys); `dist/` and `.DS_Store` are gitignored.

## Testing notes
- Tests set up via `document.body.innerHTML = '<div id="app"></div>'` in `beforeEach`.
- Environment: jsdom (configured in `vite.config.ts`, `test.environment`).
- Global state (`state`) is shared across tests — reset relevant fields in `beforeEach`.
