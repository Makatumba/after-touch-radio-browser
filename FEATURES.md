# AfterTouch Radio Browser — Planned Features (v-next)

This document is the behavior spec for the v-next release: what the app SHOULD do once the
planned features land. It is the contract for the implementation pipeline (behavior spec → impl
plan → tests → implementation → QA). Everything here is **planned, not yet implemented**; the
current state is described in [README.md](README.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## Release scope (wave 1)

v-next ships in waves. **Wave 1** (this pipeline run) covers the low-risk, self-contained
features that need no live WebSocket state: the first-run setup view, settings reconciliation,
in-browser preview, play-on-speaker as the primary card action, the device-offline banner,
language auto-detection, and the logo/branding. **Wave 2+** adds the live remote core
(WebSocket state, transport/volume commands, media-session lock-screen controls) and the PWA.

- **In wave 1:** FR-2 (setup view), FR-4 (play-on-speaker as primary action, disabled when
  offline), FR-5 (preview, default off), FR-9 (language auto-detect), FR-10 (single
  `enablePreview` toggle), FR-11 (offline banner), FR-12 (logo/branding).
- **Deferred (wave 2+):** FR-3 (WebSocket remote core), FR-6 (media-session / lock-screen
  controls), FR-8 (PWA), and the WebSocket-based now-playing confirmation in FR-4/FR-5.

## Product statement

A mobile-first, installable PWA that turns the phone into a **remote control for one Bose
SoundTouch speaker**, with the Radio Browser station picker as its main input. The speaker
plays; the phone commands. Designed for non-technical family members: one-time setup, then
open → tap a station → it plays on the speaker. Single device, remembered. Language
auto-detected (`en`/`de`/`ru`/`ukr`).

### Product decisions

- **Primary job**: the phone is the remote — the speaker plays, the phone controls (WebSocket
  state + commands are core).
- **Audience**: family first (non-technical parents), then partner/self; possible public
  announcement later.
- **Devices**: one SoundTouch device, remembered.
- **Stack**: vanilla TypeScript + Vite (no framework change).
- **Connection model**: direct to the device (no bridge service in v1). Works with every
  AfterTouch install path (on-device, local host, VPS) — the app only talks to the speaker's
  own Web API.

## Functional requirements

### FR-1 Station picker (existing, touch-adapted)

Search by name/country/language/tag; Top / Recent / Favorites modes; limit selector;
hide-broken; status line ("Loading…", "N loaded", "Service unavailable"). Data from the Radio
Browser API.

### FR-2 One-time device setup (wave 1)

Shown as a **full-screen setup view** when no speaker is configured: plain-language instructions
("Enter your speaker's address — it's in your router's device list"), input, Save. Address
sanitized (scheme and trailing slash stripped) before use, stored in the existing
`radio-browser-soundtouch-host` key. Reachability verified after save: "✓ reachable" /
"✗ unreachable", with plain-language errors. A "Browse stations anyway" link lets the user
skip setup — browsing still works, but play-on-speaker stays disabled until an address is
saved. Once saved, setup is needed only once; the address stays editable from a compact bar
(existing input + Save + status) on the main screen.

### FR-3 Device remote (core) — deferred to wave 2

Live state via WebSocket (device port 8080, "gabbo" protocol): now playing (track/artist/
source), play state, volume, mute. Transport commands play/pause/next/prev via POST (port
8090). Volume slider (debounced) + mute toggle, always mirroring device state. On connection
loss: "Connection lost — retrying", keep last-known state, auto-reconnect with backoff.
Not implemented in wave 1.

### FR-4 Play station on speaker (wave 1)

Primary action on every station card — **"Play on speaker"** — sends the station to the device;
favorites play straight to the speaker too. The action is disabled with a clear message when
the device is offline or no address is saved. On send, a plain-language confirmation appears
("Playing on speaker…"); a failed send surfaces a plain-language error and marks the device
unreachable. The separate **"Send to SoundTouch"** button is removed in wave 1 — the primary
action replaces it, including dropping the obsolete `send` translation key. The WebSocket-based
now-playing confirmation is deferred to wave 2.

### FR-5 Preview playback (disabled by default, wave 1)

In-browser preview via the existing persistent-`<audio>` pattern, behind the `enablePreview`
setting (default off). When on, a secondary **"Preview"** action on each station card plays the
station in the browser without touching device state; the in-browser player bar renders only
while preview is enabled. Disabling preview stops preview audio.

### FR-6 Media-session / lock-screen controls — deferred to wave 2

While connected, publish now-playing metadata plus play/pause/next/prev actions (→ device
commands). Graceful no-op where unsupported. Not implemented in wave 1.

### FR-7 Favorites

App-side favorite stations (existing key), one-tap play on the speaker via the primary card
action. Device presets are read-only on the API → out of scope.

### FR-8 PWA — deferred to wave 2

Installable (manifest + service worker), standalone, mobile-first touch UI. Offline: shell and
last station lists cached; device control requires LAN. Not implemented in wave 1.

### FR-9 i18n (wave 1)

All four languages; on first run (no saved language key) the language is auto-detected from
`navigator.language` (`'uk'` → `'ukr'` mapping preserved, unsupported → English) and persisted;
manual override via the existing `radio-browser-language` key wins afterwards. Every new string
is added in all four languages.

### FR-10 Settings (wave 1)

The old play-related toggles (`disablePlayer`, `disablePlayButton`, `soundtouchDefault`) are
replaced by a single **`enablePreview`** toggle (default off) — in the remote-first model the
speaker is the default player, and in-browser audio exists only as preview. Old stored settings
keys are ignored on load (defaults used). Reset restores defaults.

### FR-11 Device-offline state (wave 1)

On cellular / wrong Wi-Fi: a friendly banner "Speaker is offline — connect to the same Wi-Fi
as your speaker" appears when the saved address fails the reachability check or a send fails;
browsing still works; play-on-speaker actions are disabled with a clear message. Never crashes.

### FR-12 Branding / logo (wave 1)

The app shows the logo (`public/logo.png`, 1254×1254 PNG) as the browser tab icon (favicon), as
header branding next to the title, and as the source asset for the future PWA icon (FR-8). The
header logo has an `alt` text and scales on small screens; if the image is missing, the text
branding still renders. The favicon reference must resolve under the GitHub Pages subpath
hosting; a downscaled favicon copy is an implementation detail.

## User flows

1. **First run** — full-screen setup → enter address → verified → main screen; "Browse
   stations anyway" skips setup and browsing works.
2. **Daily use** — open app → tap a station → it plays on the speaker → "Playing on
   speaker…" confirmation. (Wave 2: see what's playing via WebSocket and control from the
   lock screen.)
3. **Offline device** — banner + disabled device actions.
4. **Preview opt-in** — Settings → enable preview → Preview action appears on station cards.

## Acceptance criteria

- **Setup**: when no address is saved, a full-screen setup view shows; a valid IP saves,
  reachability is verified ("✓ reachable" / "✗ unreachable"), and it is remembered across
  restarts; "Browse stations anyway" skips setup and browsing still works; malformed host input
  is sanitized before use.
- **Play station**: "Play on speaker" sends the station to the device and shows a plain-language
  confirmation; the action is disabled with a clear message when the device is offline or
  unconfigured; a failed send shows an error and marks the device unreachable; the separate
  "Send to SoundTouch" button is gone. Favorites play straight to the speaker too.
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
- **Deferred to wave 2**: WebSocket state within ~1s, transport/volume commands, lock-screen
  metadata + actions, PWA installability/offline.

## Edge cases

- Malformed/hostile host input (scheme, path, XSS attempts) — sanitized before use.
- No address saved but browsing (skipped setup) — play-on-speaker disabled with a plain hint to
  save the address.
- Reachability OK but send fails (device busy, network changed) — plain-language error, device
  marked unreachable; never crashes.
- Stale status renders — a check/send that resolves after a re-render must not show outdated
  state.
- Missing translations — English fallback (existing behavior).
- Missing/broken logo image — text branding still renders (graceful degradation).
- Deferred to wave 2: WebSocket reconnect storms (exponential backoff), volume drag storms
  (debounce), `INVALID_SOURCE` hint, iOS Safari blocking http/ws to LAN, multiple tabs
  (last-write-wins).

## Non-goals (v1)

- Device discovery (SSDP/mDNS — impossible from a browser; needs a future bridge).
- Multi-device, zones, presets (the preset API is read-only).
- Streaming audio as a first-class mode (preview only, default off).
- Accounts, cloud sync.
- Bass/source switching (v1 is transport + volume only).
- Logo variants (SVG/ICO, animation) — a single PNG; the small favicon copy is an implementation
  detail.

Deferred to wave 2 (see Release scope): the WebSocket remote core (FR-3), media-session /
lock-screen controls (FR-6), the PWA (FR-8), and WebSocket-based now-playing confirmation.

## Platform constraints (researched)

- An HTTPS PWA talking to an HTTP-only device: Chrome 142+ gates this behind the Local Network
  Access permission prompt; iOS Safari blocks it outright. WebSockets to LAN are not gated yet
  but are on the roadmap.
- SSDP/mDNS discovery is UDP multicast — not a browser API.
- SoundTouch is an end-of-life product line; Bose shut down the SoundTouch cloud on May 6, 2026
  and published the Web API (Jan 2026) so community software can control devices locally. The
  speaker must be migrated to AfterTouch (any install path) with the Radio Browser source
  active for stations to play. Devices will never speak HTTPS/WSS.
