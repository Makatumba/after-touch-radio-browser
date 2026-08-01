# AfterTouch Radio Browser — Planned Features (v-next)

This document is the behavior spec for the v-next release: what the app SHOULD do once the
planned features land. It is the contract for the implementation pipeline (behavior spec → impl
plan → tests → implementation → QA). Everything here is **planned, not yet implemented**; the
current state is described in [README.md](README.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

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

### FR-2 One-time device setup

Shown when no speaker is configured: plain-language instructions ("Enter your speaker's address
— it's in your router's device list"), input, Save. Address sanitized (scheme and trailing
slash stripped), stored in the existing `radio-browser-soundtouch-host` key. Reachability
verified after save: ✓ reachable / ✗ unreachable, with plain-language errors.

### FR-3 Device remote (core)

- Live state via WebSocket (device port 8080, "gabbo" protocol): now playing (track/artist/
  source), play state, volume, mute.
- Transport commands play/pause/next/prev via POST (port 8090).
- Volume slider (debounced) + mute toggle, always mirroring device state.
- On connection loss: "Connection lost — retrying", keep last-known state, auto-reconnect with
  backoff.

### FR-4 Play station on speaker

Primary action on every station card → device plays the station; now-playing panel confirms via
WebSocket. Disabled with a clear message when the device is offline.

### FR-5 Preview playback (disabled by default)

In-browser preview via the existing persistent-`<audio>` pattern, behind a new `enablePreview`
setting (default off). When on, a secondary "Preview" action plays the station in the browser
without touching device state.

### FR-6 Media-session / lock-screen controls

While connected, publish now-playing metadata plus play/pause/next/prev actions (→ device
commands). Graceful no-op where unsupported.

### FR-7 Favorites

App-side favorite stations (existing key), one-tap play on the speaker. Device presets are
read-only on the API → out of scope.

### FR-8 PWA

Installable (manifest + service worker), standalone, mobile-first touch UI. Offline: shell and
last station lists cached; device control requires LAN.

### FR-9 i18n

All four languages, auto-detect + manual override (existing key), `'uk'` → `'ukr'` mapping
preserved; every new string in all four languages.

### FR-10 Settings

Existing toggles plus a new `enablePreview` (default off). Old play-related toggles
(`disablePlayer`, `disablePlayButton`, `soundtouchDefault`) are reconciled against the
remote-first model — the exact resulting toggle set is an implementation decision.

### FR-11 Device-offline state

On cellular / wrong Wi-Fi: friendly banner "Speaker is offline — connect to the same Wi-Fi as
your speaker"; browsing still works; play-on-speaker disabled. Never crashes.

### FR-12 Branding / logo

The app shows the logo (`public/logo.png`, 1254×1254 PNG) as the browser tab icon (favicon), as
header branding next to the title, and as the source asset for the future PWA icon (FR-8). The
header logo has an `alt` text and scales on small screens; if the image is missing, the text
branding still renders. A downscaled favicon copy is an implementation detail.

## User flows

1. **First run** — setup → enter address → verified → main screen.
2. **Daily use** — open app → see what's playing on the speaker → tap a station → it plays →
   lock the phone → control from the lock screen.
3. **Offline device** — banner + disabled device actions.
4. **Preview opt-in** — Settings → enable preview → preview action appears.

## Acceptance criteria

- Setup: valid IP saves, reachability verified, remembered across restarts.
- Remote: WebSocket state reflects the device within ~1s of a change; transport/volume commands
  take effect; volume slider reconciles without echo loops.
- Play station: tapping "Play on speaker" starts the station on the device and the now-playing
  panel updates; failures show a plain-language error.
- Preview: off by default; when on, plays in-browser without disturbing device state; disabling
  it stops preview audio.
- Lock screen: metadata + actions appear while connected on supported browsers.
- i18n: all new strings translated in all four languages; auto-detect works; `'uk'` maps to
  `'ukr'`.
- PWA: installable from the hosted URL; standalone; browsing works offline.
- Device offline: correct banner; the app never crashes.
- Logo: favicon loads with no console errors; header shows the logo with alt text and no layout
  shift on small screens; text branding still renders if the image is missing.

## Edge cases

- Malformed/hostile host input (scheme, path, XSS attempts) — sanitized before use.
- Device reachable but WebSocket unavailable — degrade to REST polling or a clear "limited
  mode" message.
- Volume drag storms — debounced POSTs; reconciled via WebSocket updates.
- WebSocket reconnect storms — exponential backoff.
- Multiple browser tabs — last-write-wins, accepted limitation.
- Missing translations — English fallback (existing behavior).
- iOS Safari blocking http/ws to LAN — degrade with a plain-language message.
- Speaker reachable but the Radio Browser source is inactive (`INVALID_SOURCE`) — show a
  plain-language hint to check the AfterTouch Health tab.
- Station stream fails on the device — surface the device error event.
- Missing/broken logo image — text branding still renders (graceful degradation).

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
