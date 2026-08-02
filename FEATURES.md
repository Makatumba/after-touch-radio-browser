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
(`/json/languages` and `/json/countries`) instead of free-text inputs; the options are displayed
alphabetically by label. Language options are restricted to entries with a valid `iso_639` code
(drops the API's junk names like "engilsh" / "english uk"); values are the canonical lowercase
names and are sent with `languageExact=true`, so "english" no longer drags in "american english"
via substring matching. Country options display canonical names but send the ISO 3166-1 alpha-2
code via the `countrycode` param (exact match, immune to the API's case-sensitive `country` name
matching). If the list fetch fails, the dropdowns still render with only the "All" option and
the app keeps working. Selecting a language or country triggers the search immediately (same as
the limit select). See [API-NOTES.md](API-NOTES.md) for the full API contract.

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
  carry valid `iso_639` codes and are sent with `languageExact=true`; country options display
  canonical names but send the ISO code via `countrycode`; selecting one searches immediately;
  on list-fetch failure the dropdowns render with only the "All" option and browsing keeps
  working.
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

### FR-8 PWA

Installable (manifest + service worker), standalone, mobile-first touch UI. Offline: shell and
last station lists cached; device control requires LAN.

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
- PWA: installable from the hosted URL; standalone; browsing works offline.

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

## Platform constraints (researched)

- An HTTPS PWA talking to an HTTP-only device: Chrome 142+ gates this behind the Local Network
  Access permission prompt; iOS Safari blocks it outright. WebSockets to LAN are not gated yet
  but are on the roadmap.
- SSDP/mDNS discovery is UDP multicast — not a browser API.
- SoundTouch is an end-of-life product line; Bose shut down the SoundTouch cloud on May 6, 2026
  and published the Web API (Jan 2026) so community software can control devices locally. The
  speaker must be migrated to AfterTouch (any install path) with the Radio Browser source
  active for stations to play. Devices will never speak HTTPS/WSS.
