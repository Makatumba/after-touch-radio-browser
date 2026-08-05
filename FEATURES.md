# AfterTouch Radio Browser — Features

This document is the feature spec for AfterTouch Radio Browser: what the app does today and
what it should do once the planned features land. It is the contract for the implementation
pipeline (behavior spec → impl plan → tests → implementation → QA). Features in the
**Implemented** sections are shipped. The current state is described in [README.md](README.md) and
[ARCHITECTURE.md](ARCHITECTURE.md).

## Product statement

A mobile-first, installable PWA that turns the phone into a **remote control for one Bose
SoundTouch speaker**, with the Radio Browser station picker as its main input. The speaker
plays; the phone commands. Designed for non-technical family members: one-time setup, then
open → tap a station → it plays on the speaker. Single device, remembered. Language
auto-detected (`en`/`de`/`ru`/`ukr`).

### Product decisions

- **Primary job**: the phone is the remote — the speaker plays, the phone controls (WebSocket
  state + commands are core; live control ships in wave 2 with FR-3).
- **Audience**: family first (non-technical parents), then partner/self; possible public
  announcement later.
- **Devices**: one SoundTouch device, remembered.
- **Stack**: vanilla TypeScript + Vite (no framework change).
- **Connection model**: direct to the device (no bridge service in v1). Works with every
  AfterTouch install path (on-device, local host, VPS) — the app only talks to the speaker's
  own Web API.

## Implemented (wave 1)

Shipped features. Low-risk, self-contained: unlike the wave-2 live remote (FR-3), they need no
live WebSocket state. The setup view,
play-on-speaker as the primary card action, in-browser preview, the device-offline banner,
language auto-detection, the single preview setting, the logo/branding, and PWA
installability.

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

Search results and the Favorites list are sortable via a **"Sort by"** dropdown in the
filters panel offering five orders — Name (A–Z), Name (Z–A), Popular (1 day), Trending
(2 days), and Top all time. For search, the selection maps to the API's `order`/`reverse`
parameters (`name` with/without `reverse`; `clickcount`/`clicktrend`/`votes` with
`reverse=true`); for the locally paged favorites list it maps to a client-side comparator
over the same fields. The default is **Popular (1 day)** (`order=clickcount&reverse=true`),
which is exactly the order the app used before sorting was selectable. The dropdown always
shows the current order, and in Search and Favorites modes the results toolbar appends the
active sort label to the status line (e.g. "24 loaded · Popular (1 day)"). Changing the sort
re-runs the search (offset 0) in Search mode and re-sorts the local favorites in place
(offset 0, no API call) in Favorites mode; in Top and Recent modes it behaves like the other
filters — it starts a search with the current filters and the new sort. Favorites sort
client-side before paging: names compare with the active UI language's collation (missing
names as empty strings), `clickcount`/`clicktrend`/`votes` compare descending with missing
values as 0 (older saved favorites may lack `clicktrend`). The stored favorites array keeps
insertion order. The sort choice is session-only (not persisted) and Reset restores the
default. See [API-NOTES.md](API-NOTES.md) for the verified `order`/`reverse` mapping.

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
map can restore any API name. The last successful fetch of each option list is cached
client-side under its own localStorage key (`radio-browser-languages-cache` and
`radio-browser-countries-cache`), storing the raw fetch-time `{value, label, code}` entries —
never the localized render form, so a cached list re-localizes for any UI language. The two
lists are fetched independently, so a failure of one never discards the other. If a list's fetch
fails or returns an empty array, the cached list is used instead; when no valid cache exists
either, the dropdowns still render with only the "All" option and the app keeps working. Every
successful non-empty fetch overwrites its cache (last-known-good, no expiry); a malformed cache
is ignored and rebuilt on the next success; caching is best-effort (a full or unavailable
localStorage never breaks the current session). Selecting a language or country triggers the
search immediately (same as the limit select). See [API-NOTES.md](API-NOTES.md) for the full API
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

#### Reachability check

After save (and at startup for a saved address), the app verifies the speaker by probing the
device Web API on port 8090 — the port play commands actually use — not the admin UI on port
8000. It sends a `no-cors` `GET /info` probe: stock Bose firmware answers with a fixed CORS
allowlist that never matches the app's origin, so the response is opaque and the app only
learns whether the port answers. If it does, the device is "✓ Reachable"; if not (network
error, timeout, connection refused), "✗ Unreachable". Each attempt aborts after 5s, so a hung
device never leaves the status on "checking". An explicit port in the saved address is
honored (no `:8090` appended). Device metadata (name/type/ID) is not readable over HTTP
(the 8090 API is CORS-blocked from the browser), but the port-8080 WebSocket answers GET
requests with a REST-proxy envelope (FR-3): the app fetches `info` on connection open and
on successful (re)connection checks, so
the info widget shows the device ID, name, and type.

### FR-4 Play station on speaker

Primary action on every station card — **"Play on speaker"** — sends the station to the device;
favorites play straight to the speaker too. The action is disabled with a clear message when
the device is offline or no address is saved. Tapping play on a station shows a pending
"Sending {station} to {device}…" message; the app then confirms the send from the device's LIVE
now-playing state over the WebSocket — silent on success (the message clears, the Remote panel
mirrors the state), with a plain-language failure hint on a matching stop (`streamFailedHint`),
an invalid-source hint when the Radio Browser source is unavailable on the device
(`invalidSourceHint`), and a 15-second timeout hint (`confirmTimeoutHint`). A tap for a station
the device already plays short-circuits: no POST, no message. A failed send surfaces a
plain-language error and marks the device unreachable. The separate **"Send to SoundTouch"**
button has been removed — the primary action replaces it, including dropping the obsolete `send`
translation key.

### FR-5 Preview playback (disabled by default)

In-browser preview via the existing persistent-`<audio>` pattern, behind the `enablePreview`
setting (default off). When on, a secondary **"Preview"** action on each station card plays the
station in the browser without touching device state; the in-browser player bar renders only
while preview is enabled. Disabling preview stops preview audio. The preview path is fully
independent of the play-on-speaker confirmation (FR-4 extension): preview never arms a pending
send and never reads device state.

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
as your speaker" appears when the saved address fails the reachability check, a send fails,
or the live WebSocket connection is lost and repeated reachability probes still fail (see
FR-3); browsing still works; play-on-speaker actions are disabled with a clear message. Never
crashes.

### FR-12 Branding / logo

The app shows the logo (`public/logo.png`, 1254×1254 PNG) as the browser tab icon (favicon), as
header branding next to the title, and as the source asset for the PWA icons (see FR-8). The
header logo has an `alt` text and scales on small screens; if the image is missing, the text
branding still renders. The favicon reference resolves under the GitHub Pages subpath hosting;
a downscaled favicon copy is an implementation detail.

### FR-8 PWA — installable standalone app

Installable from the hosted URL, standalone (own window), mobile-first touch UI. Shipped as
installability (web app manifest + icons + launch behavior) and app-like polish only — **no
service worker**. The app is inherently online (station search needs the Radio Browser API,
device control needs the LAN, preview needs streaming), so offline caching, offline UI, and an
update lifecycle would add complexity without user value: when the network is unavailable the
existing "Service unavailable" status behavior applies unchanged. Installation is discovered
through native browser affordances only (Chrome/Edge desktop address-bar Install icon, Android
browser menu or browser-triggered prompt, iOS Share menu); the app ships no install banners,
hints, or prompts. Push notifications, background sync, badging, share target, and any offline
capability are non-goals (see Non-goals).

#### FR-8.1 Web app manifest & installability

- A web app manifest is served from `public/manifest.webmanifest` (Vite copies `public/` to the
  build/docs root, same convention as `public/logo.png`) and linked from `index.html` with:
  `name` ("AfterTouch Radio Browser"), `short_name` ("AfterTouch", ≤ 12 characters), `id`,
  `start_url`, and `scope` all relative (`./`) so installation works under the GitHub Pages
  subpath, `display: "standalone"`, `theme_color` `#f7f6f2` (the app chrome/first-paint
  background from `styles.css`), `background_color` `#f7f6f2`, `lang`, and icons derived from
  `public/logo.png` at 192×192 and 512×512 with `purpose: "any maskable"`.
- `index.html` links: `<link rel="manifest" href="manifest.webmanifest">`, a `theme-color` meta
  matching the manifest `theme_color`, and a relative `<link rel="apple-touch-icon">` (180×180,
  opaque) for iOS home-screen installs.
- The installed app launches in its own standalone window (no URL bar), shows the correct icon
  (including Android's maskable crop), and shows no white flash at launch (`background_color`
  matches the real first-paint background).
- No service worker: installability is manifest-based in current Chromium and Safari, so the
  app remains a plain SPA otherwise. New releases reach users on the next visit (content-hashed
  assets + normal HTTP caching) — there is no stale-worker lifecycle to manage.
- The app remains a single-screen SPA — no routes or deep links.

#### FR-8.2 App-like polish

- Launch feel: `theme-color` matches the app chrome (`#f7f6f2`, the light theme's `--bg`);
  `background_color` matches the first-paint background; `<title>` stays meaningful (it becomes
  the standalone window title).
- Touch feel: interactive chrome uses `user-select: none`; `accent-color` aligns form controls
  with the brand; scroll bounce is contained (`overscroll-behavior-y: contain`); and
  `viewport-fit=cover` + `env(safe-area-inset-*)` keeps content clear of notches and home
  indicators.

### User flows

1. **First run** — full-screen setup → enter address → verified → main screen; "Browse
   stations anyway" skips setup and browsing works.
2. **Daily use** — open app → tap a station → it plays on the speaker → the send is
   confirmed from the speaker's live state (silent on success; failure/timeout hints otherwise).
3. **Offline device** — banner + disabled device actions.
4. **Preview opt-in** — Settings → enable preview → Preview action appears on station cards.
5. **Install** — visit → browser-native install affordance (address-bar icon, browser menu, or
   iOS Share menu) → icon on launcher → launches standalone. No in-app install UI.

### Acceptance criteria

- **Setup**: when no address is saved, a full-screen setup view shows; a valid IP saves,
  reachability is verified ("✓ Reachable" / "✗ Unreachable"), and it is remembered across
  restarts; "Browse stations anyway" skips setup and browsing still works; malformed host input
  is sanitized before use.
- **Reachability check**: probing a saved address never leaves the status stuck on "checking"
  (5s timeout per attempt); an explicit port in the saved address is honored; a wrong IP that
  happens to serve something on 8090 is treated as reachable (the opaque probe cannot
  distinguish devices).
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
  localized label; selecting one searches immediately; each list's last successful non-empty
  fetch is cached raw under its own localStorage key; a failed or empty fetch falls back to the
  cached list (per list, independently); with no valid cache the dropdowns render with only the
  "All" option and browsing keeps working; a later successful fetch overwrites the cache.
- **Sorting**: the "Sort by" dropdown shows the current order with all five options localized
  in all four languages; search API calls carry the mapped `order`/`reverse` for the selected
  sort; changing the sort re-runs the search (offset 0) in Search mode, re-sorts the favorites
  in place without an API call in Favorites mode, and starts a search from Top/Recent (like
  the other filters); favorites sort handles missing numeric fields (as 0) and missing names
  (as empty strings); the stored favorites array keeps insertion order; the choice survives
  mode switches but not a page reload; Reset restores Popular (1 day).
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
- **PWA**: the manifest is valid and complete (name, short_name ≤ 12, relative
  `id`/`start_url`/`scope`, `display: "standalone"`, theme/background colors, icons 192 + 512
  incl. `maskable`); the hosted URL is installable in Chrome (DevTools installability audit);
  the installed app opens standalone, shows the correct icon (maskable-safe), and launches
  without a white flash; no service worker is registered; the app ships no install banners,
  hints, offline UI, or update UI; no new translation keys; the deploy regenerates `docs/` and
  the regenerated output is committed.

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
- A favorites station saved before sorting existed (no `clicktrend`/`clickcount`/`votes`
  fields) — treated as 0 in numeric sorts; a missing name sorts as an empty string.
- Changing the sort while a later page is shown — restarts at the first set (offset 0), like
  every other filter change.
- The ↻ refresh button always reloads the first set (offset 0), even while a later page is
  shown.
- The Language/Country list fetch fails at startup (or returns an empty array) — the dropdowns
  fall back to the last cached option list; with no valid cache they render with only the "All"
  option; search, modes, and pagination keep working.
- A stored cache is malformed (bad JSON, not an array, or entries without string
  `value`/`label`/`code`) or localStorage is unavailable/full — the cache is ignored and rebuilt
  on the next successful fetch; the current session's dropdowns are unaffected.
- `Intl.DisplayNames` unavailable or an unmappable ISO code (e.g. an unknown region code like
  "XX" — junk language entries are already filtered out at fetch time) — the canonical English
  label is shown and the dropdowns still sort in the active locale.
- Missing translations — English fallback (existing behavior).
- Missing/broken logo image — text branding still renders (graceful degradation).
- First visit offline — the app behaves exactly as today (no cached shell exists — accepted;
  the app is online-only by design).
- Android maskable crop — the maskable icon honors the safe zone (defensive padding).
- iOS — installs via the Share menu; `apple-touch-icon` is used for the home-screen icon; there
  is no `beforeinstallprompt` — irrelevant, the app ships no install UI.
- GitHub Pages subpath — all manifest URLs are relative and resolve under the subpath.
- Browser without install support — the app simply works as a normal website (unchanged).

## Implemented (wave 2)

Shipped in the live-remote wave: the WebSocket connection, live now-playing / play-state /
volume / mute mirroring, transport commands, reconnection with backoff, and the
WebSocket-fed device-info widget — plus the verbose-state extension (full now-playing
payload parsing with title/artist fallbacks, skip gating, and artwork in the Remote panel,
and the curated full device-info rows in the widget).

### FR-3 Device remote (core)

The phone is a live remote for the speaker. When an address is saved (and setup was not
skipped), the app keeps a WebSocket connection to the speaker's notification feed
(`ws://<host>:8080/`, "gabbo" protocol) open for as long as the app runs and mirrors device
state in real time: what's playing, play state, volume, mute. Commands (play/pause/next/prev,
volume, mute) go to the device Web API on port 8090 as fire-and-forget `no-cors` POSTs;
confirmation of each command arrives back over the WebSocket, which is the **only** writer of
live device state — no echo loops. Wire contracts are pinned in
[API-NOTES.md](API-NOTES.md) ("SoundTouch device wire contracts").

#### WebSocket connection lifecycle

- Connect to `ws://<host>:8080/` with the "gabbo" protocol whenever an address is saved:
  at startup for a saved address and right after the user saves one. An explicit port in the
  saved address is honored for the WebSocket too (no `:8080` appended), mirroring the 8090
  rule. Only one connection exists at a time; saving a different address closes the old
  socket and connects to the new host.
- On every connection open (first connect, reconnects, address change) the app sends a
  **state snapshot** over the same WebSocket: `GET` requests for `now_playing`, `volume`,
  and `info` in the REST-proxy `<msg>` envelope (wire contract in API-NOTES.md), with a
  `requestID` that increments per request and resets on each connection. The snapshot is
  also re-requested on every successful (re)connection check — at startup for a saved
  address and right after saving an address, where the socket is still open and the
  re-request goes out immediately (requestID continues, e.g. 4,5,6 after the open-time
  1,2,3); after a successful drop-recovery probe the socket is still closed, so that
  call no-ops and the reopened socket's on-open handler sends the fresh snapshot — so
  a missed or unanswered first snapshot gets a fresh chance at check time. There is
  no periodic or manual refresh — the snapshot exists so the Remote panel is populated at
  connect (and at each check) instead of staying blank until the first pushed event.
- Connection states: `connecting` → `connected`, `reconnecting` after a drop.

#### Live state events

Incoming messages are XML `<updates>` documents; the app parses the events it uses and
ignores everything else (malformed or unknown messages are never fatal):

- `nowPlayingUpdated` — full now-playing payload: station/track, artist, source, play status
  (`PLAY_STATE`/`PAUSE_STATE`/`BUFFERING_STATE`/`STOP_STATE`, from which the UI derives
  "playing?"), album when present.
- `volumeUpdated` (with data) — target/actual volume (0–100) and mute state.
- Signal-only events (`connectionStateUpdated`, `infoUpdated`, or a `volumeUpdated` without a
  payload) leave the last-known state untouched — the app never pulls volume mid-connection
  (HTTP `GET /volume` is CORS-blocked; snapshots run only on connection open and on
  successful (re)connection checks), so volume/mute arrive only via pushed events and the
  snapshots.
- `<msg>` responses (`msgType="RESPONSE"`) to the snapshot requests are parsed with the same
  defensive path as `<updates>`: the `<body>` payloads (`nowPlaying`, `volume`, `info`) map
  to the identical state fields the pushed events use. Responses arriving from a superseded
  connection (address changed, socket replaced) are ignored.
- The `deviceID` attribute (the speaker's MAC) on `<updates>`/`<nowPlaying>` and on snapshot
  RESPONSE `<msg>` headers feeds the device-info widget (below).

#### Remote control panel

A "Remote" panel on the main screen (visible whenever an address is saved) shows:

- **Now playing** — the live station/track, artist, and source from the WebSocket, with the
  current play status.
- **Transport** — play/pause, next, previous as icon buttons (inline SVG, inheriting the
  button color; the translated labels are kept as `aria-label` + `title` tooltips).
  Play/pause is context-aware: if the device is playing, the button pauses; otherwise it
  plays. Each command is a `POST /key` press+release pair with `sender="Gabbo"` (keys
  `PLAY`/`PAUSE`/`NEXT_TRACK`/`PREV_TRACK` — unprefixed, case-sensitive per the Bose
  documentation; see API-NOTES.md); the WebSocket update confirms the effect.
- **Volume** — a 0–100 slider mirroring the WebSocket-confirmed volume. Dragging sends one
  debounced `POST /volume` after the user stops adjusting; the slider value only ever updates
  from WebSocket events (a local POST never writes the state directly), so the device
  reconciles the slider without echo loops.
- **Mute** — an icon button (speaker-on / speaker-off, `aria-label` + `title` tooltip) that
  toggles via a `POST /volume` with a `muteenabled` element; the button reflects the
  WebSocket-confirmed mute state.

#### Connection loss & reconnection

On WebSocket close/error: keep the last-known state on screen, mark the connection
`reconnecting`, and verify the speaker is still reachable with the existing port-8090
`GET /info` probe. If the probe succeeds, keep retrying the WebSocket with capped exponential
backoff (no banner); if the probe fails, wait and retry, and only after repeated probe
failures does the device-offline banner (FR-11) appear and the device become "unreachable".
Controls are disabled while disconnected; the last-known state stays visible. The backoff
resets on a successful connection, and reconnecting stops when the address is cleared or
changed.

#### Device-info widget (WebSocket-fed)

The compact SoundTouch bar's info widget shows the **device ID**, **name**, and **type**.
The ID (the MAC address carried by the `deviceID` attribute) is observed from any message
the app uses; the name and type come from the `info` snapshot response (`<name>` /
`<type>`, e.g. "SoundTouch 10") fetched on connection open and re-requested on every
successful (re)connection check — the HTTP API stays CORS-blocked, so the WebSocket
REST-proxy response is the only source. Rows render only
when their data exists, so the widget is visible once the device ID is known and grows
name/type rows when the `info` snapshot lands. The i18n keys
`deviceName`/`deviceType`/`deviceId` exist in all four languages.

#### FR-3 extension: verbose live state & full device info

The FR-3 live remote mirrors device state verbosely, following the gesellix reference
implementation (Bose-SoundTouch): the app parses the **full** now-playing and device-info
payloads the speaker sends over the WebSocket instead of the small field subset it read
at launch, and the Remote panel and info widget surface the useful parts. The snapshot/
event mechanism itself is unchanged — requests on connection open and on every successful
(re)connection check, one snapshot per connect, no periodic or manual refresh. The verbose
snapshot RESPONSEs populate the panel and the widget right after a connection opens or
reopens. The payload shapes are pinned in [API-NOTES.md](API-NOTES.md) with a
live-verification checklist.

##### Verbose now-playing

Both pushed `nowPlayingUpdated` events and snapshot RESPONSE `<body>` payloads parse the
full now-playing payload: `track`, `artist`, `album`, `source`, `playStatus` plus
`stationName`, `art` (with `artImageStatus`), `ContentItem` (`source`/`type`/
`location` attrs, `itemName`, `containerArt`), `sourceAccount`, `time` (`total` +
position), `skipEnabled`, `skipPreviousEnabled`, `favoriteEnabled`, `seekSupported`,
`shuffleSetting`, `repeatSetting`, `streamType`, `trackID`, `position`, `description`,
`stationLocation`. Missing elements stay absent; malformed payloads stay non-fatal.

The Remote panel uses the extra data:

- **Title fallback** (gesellix display order): `track` → `stationName` →
  `ContentItem.itemName` → "No station playing".
- **Meta line**: artist, falling back to `description`, joined with album/source as today.
- **Next/Prev gating** (presence-based per the gesellix reference): Next is disabled while
  `skipEnabled` is absent, Prev disabled while `skipPreviousEnabled` is absent; enabled
  when present — the live-verification checklist confirms the real speaker's semantics.
- **Artwork**: when `art` carries a URL (falling back to `ContentItem.containerArt`), the
  panel renders it best-effort; a broken or CORS/mixed-content-blocked image degrades
  silently and the text state stays intact.

The remaining fields are stored in state for future features (time/shuffle/repeat/seek/
favorite/stream type/station location) — no UI beyond the above.

##### Full device-info widget (privacy-scoped)

The `info` snapshot RESPONSE populates the device-info payload (API-NOTES.md "Device
info"): the `deviceID` attribute plus `name`, `type`, `moduleType`, `variant`,
`variantMode`, `countryCode`, `regionCode`, `networkInfo` (IP address — the **MAC
address is deliberately not read**), the first component's category and firmware version
(the **serial number is deliberately not read**), `margeURL`, `margeAccountUUID`. The
`networkInfo` `macAddress` element and the `serialNumber` uniquely identify the physical
unit and are excluded for privacy: they are neither parsed nor displayed (the device-ID
row is a separate value carried by the `deviceID` attribute, not the `networkInfo` MAC).
The widget renders the curated set —
device ID, name, type, module type, variant, IP, firmware — one row per field, each row
rendered only when its data exists (the ID row once any used message carries it, as
before). The new row labels ship in all four languages.

##### Play/pause sync without echo loops

The play/pause button keeps deriving from the WebSocket-confirmed `devicePlayStatus`
(`PLAY_STATE` → Pause icon, else Play); a local command POST never writes live device state
(the no-echo-loop rule is unchanged). Because the verbose snapshot RESPONSEs populate the
state on connect and reconnect, the button and the now-playing panel are in sync right
after a connection opens or reopens — the panel no longer stays blank until the first
pushed event.

##### Extension user flows

1. **Verbose connect** — open the app with a saved address → the snapshot RESPONSEs populate
   the Remote panel (title with fallbacks, artist/meta line, play-status chip, artwork when
   present) and the full device-info widget within ~1s; after a reconnect the reopened
   socket's on-open snapshot re-syncs the same way (the last-known state stays visible
   during the drop).

##### Extension acceptance criteria

- After connection open and after each reconnect, the Remote panel shows the title (`track`
  → `stationName` → `itemName` fallback), the artist/meta line, and the play-status chip
  from the snapshot RESPONSEs — not blank until a pushed event.
- The play/pause button and chip reflect the WebSocket-confirmed play status; command POSTs
  never change them (no echo loop).
- Next/Prev render disabled when the payload reports skip unavailable (absent skip flag per
  the reference); enabled otherwise.
- Artwork renders when present and degrades silently when broken or blocked.
- The info widget shows the curated rows (id, name, type, module type, variant, IP,
  firmware), each rendered only when its data exists; the new row labels exist in all four
  languages.
- The MAC address and serial number from the `info` payload are never read or displayed
  (privacy).
- The API-NOTES.md live-verification checklist items for the verbose RESPONSE shapes are
  verified/ticked against a real speaker; the parser and docs are corrected if the real
  device differs from the pinned shapes.
- `npm test`, `npx tsc --noEmit --skipLibCheck`, and `npm run build` pass.

##### Extension edge cases

- Info payload with some fields missing — only the known rows render.
- Now-playing payload with no `track`/`stationName`/`itemName` — "No station playing".
- `skipEnabled`/`skipPreviousEnabled` absent — the corresponding button stays disabled
  (presence-based per the reference; semantics pending live confirmation).
- Broken or CORS/mixed-content-blocked art URL — the image is hidden, the text state stays
  intact, never fatal.
- An `info` payload that still carries a MAC address or serial number — ignored (the
  fields are never read), no rows render for them.

### User flows (wave 2)

1. **Live control** — open the app with a saved address → the Remote panel shows what's
   playing on the speaker → tap play/pause/next/prev, drag the volume slider, or toggle mute
   → the device confirms over the WebSocket within ~1s.
2. **Connection loss** — the phone leaves the home Wi-Fi → the panel keeps the last-known
   state and shows "Connection lost — retrying"; once the reachability probe also fails, the
   offline banner (FR-11) appears and the controls are disabled.

### Acceptance criteria (wave 2)

- The WebSocket connects at startup for a saved address (`ws://<host>:8080/`, "gabbo"
  protocol, explicit port honored); one connection at a time.
- On every connection open — and again on every successful (re)connection check (startup
  for a saved address, address save, successful drop-recovery probe) — the app sends
  `now_playing`/`volume`/`info` snapshot requests (REST-proxy `<msg>` envelope,
  incrementing `requestID` per request, reset per connection); RESPONSE bodies populate the
  same state fields as the pushed events; the `info` response fills the device name/type/id
  rows in the info widget. A check-triggered snapshot is only sent while the current
  socket for the current host is open; a failed check sends nothing.
- `nowPlayingUpdated` updates track/artist/source/play status; `volumeUpdated` updates
  volume/mute; unknown or malformed messages are ignored without crashing.
- Play/pause/next/prev send press+release `/key` POSTs (`sender="Gabbo"`); volume sends a
  debounced `/volume` POST; mute sends a `muteenabled` POST.
- Live device state is written only by WebSocket events — no echo loops: a local command POST
  never updates volume/play state directly.
- On close: `reconnecting` with capped exponential backoff; the backoff resets on a
  successful connection; a dropped connection triggers the reachability probe, and only
  repeated probe failures show the offline banner and disable the controls.
- The device-info widget shows the device ID once known; name/type rows are absent while no
  data exists; the widget's new i18n keys (`deviceName`/`deviceType`/`deviceId`) are added in
  all four languages.
- `npm test`, `npx tsc --noEmit --skipLibCheck`, and `npm run build` pass.

### Edge cases (wave 2)

- Malformed or unknown WebSocket messages — ignored, never fatal.
- Signal-only events (empty `volumeUpdated`, `connectionStateUpdated`, `infoUpdated`) —
  last-known state kept.
- Stale socket messages arriving after a re-render or an address change — ignored when the
  address no longer matches.
- Snapshot responses arriving after an address change or from a closed socket — ignored
  (stale-guard); the current device's state is never overwritten by a superseded
  connection.
- A missing RESPONSE (the device ignores the snapshot, or the connection drops before it
  answers) — the panel stays blank until the first pushed event or the next successful
  (re)connection check, which re-requests the snapshot: immediately for startup and
  address save (the socket is open, so the requestID continues), while after a
  drop-recovery probe the check-time call is a no-op and the reopened socket's on-open
  handler sends the fresh snapshot (existing behavior otherwise: no timeout or retry
  within a connection).
- An `info` payload without name or type — the corresponding widget rows stay hidden
  (existing conditional rendering); the device ID still shows.
- Explicit port in the saved address — honored for the WebSocket (no `:8080` appended).
- Reconnect storms — capped backoff, a single timer, one socket at a time.
- Volume drag storms — debounced POSTs, reconciled by WebSocket updates.
- iOS Safari blocking `ws://` to the LAN — the WebSocket fails, the probe fails, and the
  FR-11 banner explains the situation (existing limitation).
- Multiple browser tabs — last-write-wins, accepted limitation.
- Device reboot — the WebSocket drops and reconnects; events re-establish the state.

## Implemented (wave 3)

### FR-4 extension: now-playing confirmation

The play-on-speaker action is confirmed from the device's live now-playing state instead of
an optimistic message.

- **Lifecycle**: tapping play on a station arms a pending send — the
  `sendingToSpeaker` message with the station/device interpolations plus a single
  15-second timer — before the `/select` POST. The pending record lives module-local in
  `src/confirmation.ts` (no state fields).
- **Silent success**: a pushed `nowPlayingUpdated` (or snapshot RESPONSE) whose
  `ContentItem.location` matches the sent `/stations/byuuid/<uuid>` with `PLAY_STATE`
  confirms the send: the pending message is cleared with no extra "now playing"
  message, because the Remote panel already mirrors the live state.
- **Short-circuit**: tapping play for a station the device is already playing
  (`PLAY_STATE` + matching location) never re-sends — no POST, no message.
- **Failure signals**: a matching station with `STOP_STATE` is the stream-failed hint;
  `source="INVALID_SOURCE"` (checked first) is the invalid-source hint; the timer firing
  without a confirming payload is the timeout hint.
- **Source fallback (M5)**: if the device transforms the location, the app falls back
  to `RADIO_BROWSER` + `PLAY_STATE` — only when radio was not already playing at send
  time AND the echoed location is not a canonical `/stations/byuuid/` path (a canonical
  location different from the pending one belongs to a different station — never
  confirms). `BUFFERING_STATE` and anything else keep waiting.
- **Cancellation**: remote commands, the volume slider, an address save/clear, and the
  offline/probe-failure paths cancel the pending send.
- **No echo loops**: the watcher only reads state and writes the device message — it
  never POSTs, fetches, or requests snapshots; live state itself is written only from
  WebSocket events.

## Implemented (wave 4)

Shipped in the station-artwork wave: station cards and the Remote panel show each station's
artwork (the Radio Browser `favicon` field) behind skeleton placeholders, loaded
non-blocking and cached per station; the Remote panel's now-playing view shows the station
artwork with the device-reported `art`/`containerArt` fallback. The artwork send with play
(FR-4 integration) is pinned to the wire form below — the send itself is the next
implementation item; the wire form is live-verified against a SoundTouch 10 (2026-08-05),
see the FR-6 spec bullet.

### FR-6 Station artwork

Station lists show each station's artwork — the `favicon` field the Radio Browser API ships
on every station object, often empty (see [API-NOTES.md](API-NOTES.md) "Station object —
artwork fields") — and the artwork travels with a station when it is played on the speaker
and shows in the Remote panel's now-playing view. Loading is non-blocking and cached, and a
skeleton placeholder covers every load.

- **Artwork source**: the station `favicon` URL from the `/stations/search`,
  `/stations/topvote`, and `/stations/lastclick` responses — the only artwork field the API
  exposes in the list responses (verified live). Stations without a `favicon` render with no
  artwork and a stable card layout.
- **Skeleton pattern**: every artwork slot (station card thumbnail, Remote panel now-playing)
  renders a fixed-size skeleton placeholder while its image loads — a subtle CSS shimmer, no
  text, no broken-image icon — swapped for the loaded image without layout shift. The
  placeholder also covers the "artwork unknown yet" state (station still being fetched, or
  the cached artwork missing).
- **Non-blocking load**: artwork never blocks rendering or interaction. List rendering and
  image loading are independent: cards render immediately, images resolve in the background
  (browser-native lazy loading plus a background artwork fetch), and in-flight loads for
  stations that scrolled out of view or were replaced by a re-render are discarded.
- **Cache**: the artwork URL is cached per station under the localStorage key
  `radio-browser-art-<stationuuid>` (last-known-good, best-effort — the same convention as
  the language/country option caches in FR-1): repeat renders, paging, re-searches, and the
  favorites list reuse the cached URL without refetching the station, and the browser's own
  HTTP cache serves the image bytes. A malformed or unavailable cache is ignored and rebuilt
  from the next successful fetch; caching is never fatal.
- **Send with play (FR-4 integration)**: playing a station on the speaker sends its artwork
  with it, so the speaker's own display shows the station logo: the `/select` body carries
  the station name (`<itemName>`) and the station artwork URL (`<containerArt>`, the
  `favicon` falling back to the per-station cache) as `ContentItem` children — included only
  when known, XML-escaped, matching the reference implementation's `ContentItem` contract
  (`omitempty` semantics). The send is best-effort: the app's Remote panel shows the station
  artwork in the now-playing view with the same skeleton pattern, falling back to the
  device-reported `art`/`containerArt` when the station artwork is unavailable. The exact
  wire form is pinned in [API-NOTES.md](API-NOTES.md) ("Commands — HTTP API, POST `/select`")
  and live-verified against a SoundTouch 10 (2026-08-05): the device accepts the body with
  children, echoes `<itemName>`/`<containerArt>` back verbatim in the now-playing
  `ContentItem`, and the app's Remote panel shows the artwork through the
  `ContentItem.containerArt` fallback; the device's own `<art>` field stays
  `SHOW_DEFAULT_IMAGE` — the RADIO_BROWSER source does not propagate the sent art into it, so
  the send never affects playback.
- **Degradation**: an empty, dead, or CORS/mixed-content-blocked artwork URL (the app is
  hosted on HTTPS; many station favicons are plain http) degrades silently — the skeleton
  gives way to an empty slot, the text state stays intact, never fatal.

#### User flows (wave 4)

1. **Browse with artwork** — open the app → station lists render immediately with skeleton
   thumbnails → each thumbnail fills in as its artwork loads (cached stations fill instantly).
2. **Play with artwork** — tap a station → it plays on the speaker and the artwork (and
   name) is sent with it (best-effort, per the pinned wire form) → the Remote panel shows
   the station artwork in the now-playing view.

#### Acceptance criteria (wave 4)

- Station cards show the artwork thumbnail from the station's `favicon` field.
- A skeleton placeholder covers every artwork load and never shifts the layout; no
  broken-image icons appear.
- Artwork loads asynchronously; list rendering and interaction are never blocked.
- The artwork URL is cached per `stationuuid` and reused across paging, mode changes,
  re-searches, favorites, and sessions; a malformed cache is ignored, never fatal.
- Playing a station includes its artwork (and name, when known) in the send
  (best-effort, XML-escaped, `omitempty`-style), and the Remote panel shows the artwork in
  the speaker's now-playing view with the skeleton pattern and the device-reported
  `art`/`containerArt` fallback.
- Any new UI strings ship in all four languages (`en`, `de`, `ru`, `ukr`).
- `npm test`, `npx tsc --noEmit --skipLibCheck`, and `npm run build` pass.

#### Edge cases (wave 4)

- Station without a `favicon` (empty/missing field) — no artwork, stable card layout.
- Artwork URL dead, non-image, or CORS/mixed-content-blocked — silent degradation, no
  broken-image icon, the text state stays intact.
- localStorage full or unavailable — cache writes are skipped, images still load per render.
- A malformed cached URL (bad JSON, non-string) — ignored and rebuilt on the next fetch.
- Fast paging / rapid re-renders — in-flight loads for stations that left the view are
  discarded; a stale image must never land in a card that now shows a different station.
- The speaker reports no `art`/`containerArt` and the station has no `favicon` — the Remote
  panel renders without artwork; everything else stays intact.

## Non-goals (v1)

- Device discovery (SSDP/mDNS — impossible from a browser; needs a future bridge).
- Multi-device, zones, presets (the preset API is read-only).
- Streaming audio as a first-class mode (preview only, default off).
- Accounts, cloud sync.
- Bass/source switching (v1 is transport + volume only).
- Device name/type display over HTTP (the HTTP API is CORS-blocked from the browser) — the
  app reads device info over the WebSocket REST-proxy instead (FR-3).
- Logo variants (SVG/ICO, animation) — a single PNG; the small favicon copy is an implementation
  detail.
- PWA extras beyond the FR-8 wave's scope: a service worker, offline support / offline UI,
  update lifecycle, push notifications, background sync, badging, share target, and in-app
  install banners or hints (browser-native install affordances only).

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
  (`<user>.github.io/after-touch-radio-browser/`). All manifest URLs (`id`, `start_url`,
  `scope`, icon `src`) must stay relative to resolve under the subpath. HTTPS is satisfied by
  GitHub Pages and is required for installability.
- iOS Safari: no `beforeinstallprompt` and no automatic install prompt — users install via the
  Share menu ("Add to Home Screen"); `apple-touch-icon` is used for the home-screen icon. The
  app ships no install UI, so this only affects discoverability, not behavior.
- Chrome installability criteria: manifest `name`, `icons` 192 + 512 (incl. maskable-safe),
  `start_url`, `display` of standalone/fullscreen/minimal-ui, HTTPS, and an engagement heuristic
  (≥ 1 click and ≥ 30 s) — `beforeinstallprompt` fires only when these are met.
