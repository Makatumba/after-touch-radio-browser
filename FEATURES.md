# AfterTouch Radio Browser — Features

This document is the feature spec for AfterTouch Radio Browser: what the app does today and
what it should do once the planned features land. It is the contract for the implementation
pipeline (behavior spec → impl plan → tests → implementation → QA). Features in the
**Implemented** section are shipped; features in the **Planned** section are not yet
implemented. The current state is described in [README.md](README.md) and
[ARCHITECTURE.md](ARCHITECTURE.md).

## Product statement

A mobile-first, installable PWA that turns the phone into a **remote control for one Bose
SoundTouch speaker**, with the Radio Browser station picker as its main input. The speaker
plays; the phone commands. Designed for non-technical family members: one-time setup, then
open → tap a station → it plays on the speaker. Single device, remembered. Language
auto-detected (`en`/`de`/`ru`/`ukr`).

### Product decisions

- **Primary job**: the phone is the remote — the speaker plays, the phone controls (WebSocket
  state + commands are core; live control is planned, see below).
- **Audience**: family first (non-technical parents), then partner/self; possible public
  announcement later.
- **Devices**: one SoundTouch device, remembered.
- **Stack**: vanilla TypeScript + Vite (no framework change).
- **Connection model**: direct to the device (no bridge service in v1). Works with every
  AfterTouch install path (on-device, local host, VPS) — the app only talks to the speaker's
  own Web API.

## Implemented (wave 1)

Shipped features. Low-risk, self-contained: they need no live WebSocket state. The setup view,
play-on-speaker as the primary card action, in-browser preview, the device-offline banner,
language auto-detection, the single preview setting, and the logo/branding.

### FR-1 Station picker (existing, touch-adapted)

Search by name/country/language/tag; Top / Recent / Favorites modes; limit selector;
hide-broken; status line ("Loading…", "N loaded", "Service unavailable"). Data from the Radio
Browser API.

Results are paged: **Prev/Next** buttons under the list move within the current mode's results
in fixed-size sets (the limit selector's value) — they never switch lists. Next loads the
following set (API offset, or the next slice of the local favorites list); Prev returns to the
previous set, clamped at the first. Favorites page through the local favorites array, with no
API call. A mode change, a new search, a filter change, or reset always restarts at the first
set (offset 0); the ↻ refresh button reloads the first set too.

The Language and Country filters are dropdowns fed once at app start by the Radio Browser API
(`/json/languages` and `/json/countries`) instead of free-text inputs. Option labels are
localized to the active UI language: each option carries its ISO code (`iso_639` for languages,
`iso_3166_1` for countries) and `Intl.DisplayNames` renders the localized name (e.g. German UI:
`DE` → "Deutschland", `en` → "Englisch"; Ukrainian UI: `DE` → "Німеччина"), with a small
per-language override map in `src/i18n.ts` (`filterLabelOverrides`) that wins over
`Intl.DisplayNames`, and the canonical English label as fallback when a code cannot be mapped or
`Intl.DisplayNames` is unavailable. The options are sorted alphabetically by the localized label
using the active language's collation. Switching the UI language re-renders the dropdowns in the
new locale immediately — no refetch. Language options are restricted to entries with a valid
`iso_639` code (drops the API's junk names like "engilsh" / "english uk"); values are the
canonical lowercase names and are sent with `languageExact=true`, so "english" no longer drags
in "american english" via substring matching. Country options display localized names but send
the ISO 3166-1 alpha-2 code via the `countrycode` param (exact match, immune to the API's
case-sensitive `country` name matching). In the English UI the labels appear in canonical title
case ("English", "United Kingdom") rather than the API's lowercase/quirky names; the override
map can restore any API name. If the list fetch fails, the dropdowns still render with only the
"All" option and the app keeps working. Selecting a language or country triggers the search
immediately (same as the limit select). See [API-NOTES.md](API-NOTES.md) for the full API
contract.

### FR-2 One-time device setup

Shown as a **full-screen setup view** when no speaker is configured: plain-language instructions
("Enter your speaker's address — it's in your router's device list"), input, Save. Address
sanitized (scheme and trailing slash stripped) before use, stored in the existing
`radio-browser-soundtouch-host` key. Reachability verified after save: "✓ Reachable" /
"✗ Unreachable", with plain-language errors. A "Browse stations anyway" link lets the user
skip setup — browsing still works, but play-on-speaker stays disabled until an address is
saved. Once saved, setup is needed only once; the address stays editable from a compact bar
(input + Save + status) on the main screen.

### FR-4 Play station on speaker

Primary action on every station card — **"Play on speaker"** — sends the station to the device;
favorites play straight to the speaker too. The action is disabled with a clear message when
the device is offline or no address is saved. On send, a plain-language confirmation appears
("Playing on speaker…"); a failed send surfaces a plain-language error and marks the device
unreachable. The separate **"Send to SoundTouch"** button has been removed — the primary action
replaces it, including dropping the obsolete `send` translation key. A WebSocket-based
now-playing confirmation is planned (see FR-3).

### FR-5 Preview playback (disabled by default)

In-browser preview via the existing persistent-`<audio>` pattern, behind the `enablePreview`
setting (default off). When on, a secondary **"Preview"** action on each station card plays the
station in the browser without touching device state; the in-browser player bar renders only
while preview is enabled. Disabling preview stops preview audio.

### FR-7 Favorites

App-side favorite stations (existing key), one-tap play on the speaker via the primary card
action. Device presets are read-only on the API → out of scope.

### FR-9 i18n

All four languages; on first run (no saved language key) the language is auto-detected from
`navigator.language` (`'uk'` → `'ukr'` mapping preserved, unsupported → English) and persisted;
manual override via the existing `radio-browser-language` key wins afterwards. Every new string
is added in all four languages.

### FR-10 Settings

A single **`enablePreview`** toggle (default off) replaced the old play-related toggles
(`disablePlayer`, `disablePlayButton`, `soundtouchDefault`) — in the remote-first model the
speaker is the default player, and in-browser audio exists only as preview. Old stored settings
keys are ignored on load (defaults used). Reset restores defaults.

### FR-11 Device-offline state

On cellular / wrong Wi-Fi: a friendly banner "Speaker is offline — connect to the same Wi-Fi
as your speaker" appears when the saved address fails the reachability check or a send fails;
browsing still works; play-on-speaker actions are disabled with a clear message. Never crashes.

### FR-12 Branding / logo

The app shows the logo (`public/logo.png`, 1254×1254 PNG) as the browser tab icon (favicon), as
header branding next to the title, and as the source asset for the future PWA icon (see FR-8,
planned). The header logo has an `alt` text and scales on small screens; if the image is
missing, the text branding still renders. The favicon reference resolves under the GitHub Pages
subpath hosting; a downscaled favicon copy is an implementation detail.

### User flows

1. **First run** — full-screen setup → enter address → verified → main screen; "Browse
   stations anyway" skips setup and browsing works.
2. **Daily use** — open app → tap a station → it plays on the speaker → "Playing on
   speaker…" confirmation.
3. **Offline device** — banner + disabled device actions.
4. **Preview opt-in** — Settings → enable preview → Preview action appears on station cards.

### Acceptance criteria

- **Setup**: when no address is saved, a full-screen setup view shows; a valid IP saves,
  reachability is verified ("✓ Reachable" / "✗ Unreachable"), and it is remembered across
  restarts; "Browse stations anyway" skips setup and browsing still works; malformed host input
  is sanitized before use.
- **Play station**: "Play on speaker" sends the station to the device and shows a plain-language
  confirmation; the action is disabled with a clear message when the device is offline or
  unconfigured; a failed send shows an error and marks the device unreachable; the separate
  "Send to SoundTouch" button is gone. Favorites play straight to the speaker too.
- **Pagination**: Prev/Next page within the current mode's list (never switch lists); Prev is
  disabled on the first set and Next on a short/empty final set, both staying visible;
  favorites page through the local list without an API call; a mode change, new search, filter
  change, or reset restarts at the first set.
- **Filter dropdowns**: Language and Country are dropdowns (not free-text); language options
  carry valid `iso_639` codes and are sent with `languageExact=true`; country options send the
  ISO code via `countrycode`; labels are localized to the active UI language and sorted by the
  localized label; selecting one searches immediately; on list-fetch failure the dropdowns
  render with only the "All" option and browsing keeps working.
- **Preview**: off by default; when on, a Preview action plays in-browser without disturbing
  device state; disabling it stops preview audio.
- **i18n**: language is auto-detected on first run (`'uk'` → `'ukr'`, unsupported → English);
  manual override wins; all new strings are translated in all four languages.
- **Device offline**: the correct banner appears when the reachability check fails or a send
  fails; the app never crashes.
- **Settings**: exactly one `enablePreview` toggle (default off); old settings keys are ignored
  on load; reset restores defaults.
- **Logo**: favicon loads with no console errors; header shows the logo with alt text and no
  layout shift on small screens; text branding still renders if the image is missing.

### Edge cases

- Malformed/hostile host input (scheme, path, XSS attempts) — sanitized before use.
- No address saved but browsing (skipped setup) — play-on-speaker disabled with a plain hint to
  save the address.
- Reachability OK but send fails (device busy, network changed) — plain-language error, device
  marked unreachable; never crashes.
- Stale status renders — a check/send that resolves after a re-render must not show outdated
  state.
- A final set with exactly `limit` stations — Next stays enabled once more and the following
  page is empty (the API exposes no total count, so a short set is the only signal).
- The ↻ refresh button always reloads the first set (offset 0), even while a later page is
  shown.
- The Language/Country list fetch fails at startup — the dropdowns render with only the "All"
  option; search, modes, and pagination keep working.
- `Intl.DisplayNames` unavailable or an unmappable ISO code (e.g. an unknown region code like
  "XX" — junk language entries are already filtered out at fetch time) — the canonical English
  label is shown and the dropdowns still sort in the active locale.
- Missing translations — English fallback (existing behavior).
- Missing/broken logo image — text branding still renders (graceful degradation).

## Planned (wave 2+)

Not yet implemented. These features build the live remote on top of the shipped wave-1 base:
the WebSocket remote core, media-session / lock-screen controls, the PWA, and confirmation of
play actions from live device state.

### FR-3 Device remote (core)

Live state via WebSocket (device port 8080, "gabbo" protocol): now playing (track/artist/
source), play state, volume, mute. Transport commands play/pause/next/prev via POST (port
8090). Volume slider (debounced) + mute toggle, always mirroring device state. On connection
loss: "Connection lost — retrying", keep last-known state, auto-reconnect with backoff.

### FR-6 Media-session / lock-screen controls

While connected, publish now-playing metadata plus play/pause/next/prev actions (→ device
commands). Graceful no-op where unsupported.

### FR-8 PWA — installable, offline-ready

Installable (manifest + service worker), standalone, mobile-first touch UI. The app shell loads
without internet, favorites and the last loaded station list stay usable offline, and device
control keeps requiring LAN. Scope of this wave: installability, offline shell + last-list
cache, in-app install UX, and a user-controlled update prompt. Push notifications, background
sync, badging, share target, and offline-first search caching are non-goals for this wave (see
Non-goals).

#### FR-8.1 Web app manifest & installability

- A web app manifest is linked from `index.html` with: `name` ("AfterTouch Radio Browser"),
  `short_name` (≤ 12 characters), `start_url` and `id` relative to the hosting subpath,
  `display: "standalone"`, `scope` covering the app subpath, `theme_color` matching the app
  chrome, `background_color` matching the app background, `lang`, and icons derived from
  `public/logo.png` at 192×192 and 512×512 including a `purpose: "any maskable"` variant.
- `index.html` adds: `<link rel="manifest">`, `theme-color` meta (the current light theme's
  chrome color; a dark variant only if a dark theme is added this wave), and
  `apple-touch-icon` for iOS home-screen installs.
- The installed app launches in its own standalone window (no URL bar), shows the correct icon
  (including Android's maskable crop), and shows no white flash at launch (`background_color`
  matches the real first-paint background).
- Installability works under the GitHub Pages subpath hosting: relative asset paths
  (`base: ''`), relative `start_url`, and a service worker scoped to the app subpath.
- The app remains a single-screen SPA — no routes or deep links to design.

#### FR-8.2 Service worker & caching

- One service worker registered at the app scope after the first render; it never blocks first
  paint and never controls the very first page load (the normal network path stays the default
  on first visit).
- Precached app shell: HTML, CSS, JS bundles, icons, logo.
- Caching strategy per request class:
  - Versioned static assets (content-hashed JS/CSS) → cache-first (safe by construction).
  - Navigations (index.html) → network-first with cached-shell fallback, so a new release is
    never stuck behind a stale cache.
  - Radio Browser API reads (search/topvote/lastclick/languages/countries) → network-first with
    cache fallback: the last successful response per request is cached and served when offline
    or on failure. This is what keeps "the last loaded station list" visible offline.
  - SoundTouch device calls (ports 8000/8090, `no-cors`, LAN HTTP) → never intercepted, never
    cached; device control always goes to the network.
  - POSTs, auth, redirects, and non-2xx responses → never cached.
- Cache names are versioned (e.g. `radio-browser-shell-v1`) and old caches are purged on
  activate; runtime caches are capped (entries/TTL) so storage stays bounded.
- No separate `offline.html` route: the SPA shell itself renders the offline state.

#### FR-8.3 Offline behavior

- With no internet: the app shell renders, the Favorites tab works fully (local list), the last
  loaded station list shows from cache, and the Language/Country dropdowns render with only the
  "All" option (existing failure path).
- When the last list is shown from cache, a subtle plain-language indicator communicates that
  the list may be stale ("offline — showing the last loaded list").
- New searches / mode changes that need the network show a plain-language offline message in
  the status line ("You're offline — connect to the internet to search") instead of the generic
  "Service unavailable"; the app never crashes and never shows the browser error page.
- Play-on-speaker behavior is unchanged: it requires the LAN and shows the existing
  device-offline banner when unreachable; preview playback fails gracefully (audio error) with
  no crash.
- Online/offline transitions re-render status without stale race conditions (existing
  stale-render guard pattern).

#### FR-8.4 Install UX

- `beforeinstallprompt` is captured and deferred; the install affordance appears only in
  browser display mode, only after the event fired, and never on the very first visit without
  engagement (engagement = at least one interaction and ~30 s of use, per Chrome's
  installability heuristic).
- The in-app **"Install app"** button lives out of the way of the primary user journey (e.g.
  header or navigation area), is dismissible, and its dismissal is remembered so it does not
  nag. It is hidden in standalone mode (`@media (display-mode: browser)`), hidden after
  `appinstalled`, and hidden when the browser cannot prompt.
- Activating it shows the browser's own install dialog via the deferred prompt.
- On iOS Safari (no `beforeinstallprompt`): a short, dismissible "Add to Home Screen" hint with
  plain-language instructions shows in browser mode only; it does not repeat obsessively.
- All install strings exist in all four languages.

#### FR-8.5 Update UX

- When a new service worker installs while an old one controls the page, a plain-language
  "Update available — reload" prompt appears.
- Reload happens only on explicit user action (posts `SKIP_WAITING`, then reloads); no silent
  `skipWaiting()`/`clients.claim()` that would yank a mid-action session.
- First visits (no controlling worker) never see the prompt.

#### FR-8.6 App-like polish

- Launch feel: `theme-color` matches app chrome (current light theme; a dark variant only if a
  dark theme is added this wave); `background_color` matches the first-paint background;
  `<title>` stays meaningful (it becomes the standalone window title).
- Touch feel: interactive chrome uses `user-select: none`, `accent-color` aligns form controls
  with the brand, tap feedback is instant, scroll bounce is contained where app-like
  (`overscroll-behavior`), `100dvh`-style height handling avoids mobile URL-bar shifts, and
  `viewport-fit=cover` + `env(safe-area-inset-*)` keeps content clear of notches and home
  indicators.

#### User flows

1. **Install (Chrome/Edge/Android)** — visit → browse (engagement) → "Install app" appears →
   click → browser install dialog → icon on launcher → launches standalone.
2. **Install (iOS Safari)** — visit → "Add to Home Screen" hint → share menu → Add → icon on
   home screen → launches standalone.
3. **Offline browse** — launch with no internet → shell renders, Favorites work, last loaded
   list shows with the offline/stale indicator, new search shows the offline message.
4. **Update** — old version open → new version deployed → "Update available — reload" →
   user reloads → new version.
5. **Daily use (unchanged)** — open → tap a station → it plays on the speaker.

#### Acceptance criteria

- Manifest is valid and complete; the hosted URL is installable in Chrome (manifest complete,
  HTTPS, engagement met — per the DevTools installability audit); the installed app opens
  standalone, shows the correct icon (maskable-safe), and launches without a white flash.
- Offline (DevTools network disabled): shell renders, Favorites tab is fully functional, the
  last loaded list is visible with the stale indicator, a new search shows the offline message,
  dropdowns degrade to "All", and the app never crashes or shows a browser error page.
- Play-on-speaker works on the LAN with no internet; device calls are never cached; the
  existing device-offline banner still appears when the device is unreachable.
- Install button: only in browser mode, only after `beforeinstallprompt`, opens the browser
  dialog, hides after install/dismissal, and is absent in standalone mode. iOS hint shows only
  in Safari browser mode and is dismissible.
- Update prompt appears when a new service worker is waiting; the app reloads only on user
  action; no silent takeover.
- All new strings are translated in en/de/ru/ukr with the English fallback.
- `npm test`, `npx tsc --noEmit --skipLibCheck`, and `npm run build` pass; the deploy
  regenerates `docs/` and the regenerated output is committed.

#### Edge cases

- First ever visit offline (empty cache): the shell cannot load — accepted and documented (the
  app must be visited online at least once; nothing can be served from an empty cache).
- First ever visit online: the service worker registers but must not block or break the first
  load (no controlling worker yet).
- GitHub Pages/HTTP caching of `index.html` vs. a fresh service worker: navigation is
  network-first so a stale shell never sticks; the SW script is fetched without trusting the
  HTTP cache.
- Network flips mid-session (online ↔ offline): status re-renders without stale results
  (existing stale-render guard).
- API fetch fails offline: cached last response is served; without a cache, the offline
  message; dropdown lists degrade to "All" only.
- Storage pressure / browser eviction: runtime caches are capped; iOS may evict caches and
  IndexedDB after ~7 days of inactivity — offline data may disappear then; the app degrades to
  first-visit-offline behavior.
- Multiple tabs: last-write-wins, accepted limitation.
- Old SW + new HTML mismatch: prevented by network-first navigation; the update prompt handles
  the remaining window.
- `beforeinstallprompt` never fires (unsupported browser/device): the install button stays
  hidden; nothing else breaks.
- Device unreachable while internet works: existing banner + disabled play actions.

### FR-4/FR-5 extension: now-playing confirmation

Once FR-3 lands, play-on-speaker and preview confirmations come from live device state
(WebSocket) instead of the current optimistic "Playing on speaker…" message.

### User flows

1. **Live control** — open app → see what's playing on the speaker → control playback and
   volume from the phone → lock the phone → control from the lock screen.

### Acceptance criteria

- WebSocket state reflects the device within ~1s of a change; transport/volume commands take
  effect; the volume slider reconciles without echo loops.
- Lock screen: metadata + actions appear while connected on supported browsers.

### Edge cases

- Device reachable but WebSocket unavailable — degrade to REST polling or a clear "limited
  mode" message.
- WebSocket reconnect storms — exponential backoff.
- Volume drag storms — debounced POSTs; reconciled via WebSocket updates.
- Multiple browser tabs — last-write-wins, accepted limitation.
- iOS Safari blocking http/ws to LAN — degrade with a plain-language message.
- Speaker reachable but the Radio Browser source is inactive (`INVALID_SOURCE`) — show a
  plain-language hint to check the AfterTouch Health tab.
- Station stream fails on the device — surface the device error event.

## Non-goals (v1)

- Device discovery (SSDP/mDNS — impossible from a browser; needs a future bridge).
- Multi-device, zones, presets (the preset API is read-only).
- Streaming audio as a first-class mode (preview only, default off).
- Accounts, cloud sync.
- Bass/source switching (v1 is transport + volume only).
- Logo variants (SVG/ICO, animation) — a single PNG; the small favicon copy is an implementation
  detail.
- PWA extras beyond the FR-8 wave's scope: push notifications, background sync, badging, share
  target, offline-first search caching.

## Platform constraints (researched)

- An HTTPS PWA talking to an HTTP-only device: Chrome 142+ gates this behind the Local Network
  Access permission prompt; iOS Safari blocks it outright. WebSockets to LAN are not gated yet
  but are on the roadmap.
- SSDP/mDNS discovery is UDP multicast — not a browser API.
- SoundTouch is an end-of-life product line; Bose shut down the SoundTouch cloud on May 6, 2026
  and published the Web API (Jan 2026) so community software can control devices locally. The
  speaker must be migrated to AfterTouch (any install path) with the Radio Browser source
  active for stations to play. Devices will never speak HTTPS/WSS.
- PWA hosting: GitHub Pages serves the app from the `docs/` folder under the repo subpath
  (`<user>.github.io/after-touch-radio-browser/`). A service worker's scope is limited to its
  own directory, so the worker lives at the app subpath root and covers exactly the app; the
  manifest `start_url`/`id`/icons must stay relative. HTTPS is satisfied by GitHub Pages and is
  required for service workers and installability.
- iOS Safari: no `beforeinstallprompt` and no automatic install prompt — users install via the
  Share menu ("Add to Home Screen"), so an in-app hint is required; `apple-touch-icon` is used
  for the home-screen icon. iOS may evict service-worker caches and IndexedDB after roughly 7
  days of inactivity.
- Chrome installability criteria: manifest `name`, `icons` 192 + 512 (incl. maskable-safe),
  `start_url`, `display` of standalone/fullscreen/minimal-ui, HTTPS, and an engagement heuristic
  (≥ 1 click and ≥ 30 s) — `beforeinstallprompt` fires only when these are met.
