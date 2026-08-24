# After Touch Radio Browser — Android Cordova wrapper

Native Android shell for the GitHub-hosted **After Touch Radio Browser** web
app. This folder is part of the web app repository (`cordova/` subproject);
the wrapper keeps a tiny local Cordova document and loads the *current*
hashed frontend assets from GitHub Pages at every cold launch, so the packaged
app always runs the latest deployed web build without an app-store update.

Branding assets (`res/icons/android/*`, `res/splash/splash-icon.png`) are
derived from `resources/branding/logo-source.png` (a pinned copy of the web
app's `public/logo.png` — the same asset behind the PWA manifest icons) with
macOS `sips`; refresh that copy first if the logo ever changes.

```
Web PWA (unchanged)                    This wrapper
https://makatumba.github.io/…   ──►    app-assets.json ──► hashed CSS + JS
        ▲                                            injected into the LOCAL
        └── same source project, normal deploy       document (this APK)
```

The speaker itself is controlled directly over the home LAN
(`http://<speaker-ip>:8090`, live state via `ws://<speaker-ip>:8080`) — no
backend, proxy, or relay exists or is allowed by project policy.

## How it works

1. `www/index.html` (local, bundled in the APK) sets
   `window.__AFTER_TOUCH_RUNTIME__ = 'cordova'`, loads `cordova.js`, then
   `www/loader.js`.
2. After `deviceready` (with a 1.5 s browser-development fallback),
   `loader.js` fetches `app-assets.json` with `cache: 'no-store'` + a query
   cache-buster.
3. Every manifest asset path is resolved with `new URL(path, MANIFEST_URL)` and
   **must land on `https://makatumba.github.io`** before injection — a tampered
   manifest cannot point the shell at another script origin.
4. CSS is injected first, then the Vite ES-module entry. The web app builds
   with relative asset URLs (`base: ''`), so all module imports resolve against
   their own GitHub Pages URL regardless of the local document location.
5. The remote bundle detects the wrapper through `isCordovaRuntime()`
   (`src/runtime.ts` in the web repo); the document also carries
   `data-after-touch-runtime="cordova"` on `<html>` after boot for device-test
   verification.

### Why `AndroidInsecureFileModeEnabled`

Audited against the pinned platform (`rg 'setMixedContentMode|MIXED_CONTENT'
platforms/android/CordovaLib/src' → **zero hits** in cordova-android@15):
there is no mixed-content setting to flip, and Cordova's default virtual
`https://localhost` origin would apply strict browser mixed-content blocking
to the speaker's plaintext `http/ws` traffic. Serving the local shell from
`file://` (this flag) takes the document out of secure-context scope entirely
— the platform-sanctioned route for this exact use case. Trade-off: a
`file://` origin is not a "secure context"; this app deliberately uses nothing
that requires one (no offline-shell registration, no install prompts, no
`crypto.subtle`, no camera/mic). OS-level cleartext policy is still enforced
by `usesCleartextTraffic` + the network security config.

## Prerequisites

- Node.js 18+ (Cordova CLI runs as a local dev dependency — no global install)
- Android SDK + JDK 17+ and `ANDROID_HOME` configured
  (`npx cordova requirements android` reports what is missing)

## Build & run

```sh
npm install                 # installs cordova CLI locally
npx cordova platform add android    # skip if platforms/ already exists
npm run requirements        # verify the toolchain
npm run android:build       # debug APK → platforms/android/app/build/outputs/apk/debug/
npm run android             # build, install, and launch on a connected device
```

No Cordova plugins are required: networking uses standard `fetch`/`WebSocket`,
`deviceready` comes from core `cordova.js`, and the Android 12+ system splash
screen is configured through core preferences (`AndroidWindowSplashScreen*`
— background `#f7f6f2` plus the brand logo as the masked splash icon).

## Updating the web app inside the wrapper

Nothing to do here. Deploy the web repo as usual:

```sh
cd .. && npm run deploy && git add docs && git commit -m "chore: regenerate docs/ from latest build"
```

The next **cold launch** of the wrapper fetches the new `app-assets.json`
(published last by the deploy flow; asset filenames are content-hashed and
immutable), so one version's manifest can never mix with another version's
modules. A failed/incomplete deploy surfaces as the boot error screen — press
**Retry**. There is deliberately no offline cache/updater yet (see handoff
non-goals).

## Device test checklist

Run on a real Android device on the same Wi-Fi as a Bose SoundTouch speaker
(running [AfterTouch](https://gesellix.github.io/Bose-SoundTouch/) firmware
with the Radio Browser source active).

Boot & loading
- [ ] App opens to the **local** shell boot screen, not the GitHub Pages document
      (`chrome://inspect` → the document URL is `file:///android_asset/index.html`).
- [ ] With internet on: boot screen disappears; `<html>` carries
      `data-after-touch-runtime="cordova"` and `data-after-touch-started="true"`.
- [ ] Manifest version in `adb logcat`/console matches the current web deploy.
- [ ] Styles load before the app script; fonts/colors match the web PWA.

Runtime behavior
- [ ] No service-worker registration appears under chrome://inspect → Application.
- [ ] No browser install prompt/banner ever appears (there is none by design).
- [ ] Station search works (Radio Browser API reachable).

Speaker communication (the point of the wrapper)
- [ ] Saving the speaker address shows ✓ Reachable (HTTP `POST/GET :8090`).
- [ ] Play-on-speaker sends the station; Remote panel mirrors now-playing,
      volume, mute over the `ws://…:8080` feed.
- [ ] Transport/volume/mute commands actuate the speaker.
- [ ] Leaving the Wi-Fi: connection lost → reconnect backoff → offline banner
      (speaker failures stay separate from boot failures).

Failure paths
- [ ] Internet off at launch: clear error message + working **Retry**; no crash.
- [ ] Retry before any JS loaded re-fetches without duplicates; after a
      successful load the button switches to **Reload app** (full reload —
      prevents double-initializing the app).
- [ ] Web-deploy upgrade: push a new web build → next cold launch picks up the
      new version string.

Security spot-checks
- [ ] Serve a tampered manifest (e.g. via a proxy rewriting `js[]` to another
      origin) → loader refuses with "Refusing asset outside approved origin".
- [ ] Release build does not enable WebView debugging unintentionally
      (inspect `cordova.require('cordova/exec')` behavior / build config).
- [ ] No credentials/sensitive data are sent to cleartext endpoints (the app
      sends only station-selection XML and transport keys).

## Security notes

- **Speaker traffic is unencrypted.** The SoundTouch protocol only speaks
  plaintext HTTP (:8090) and WS (:8080) on the LAN. The app sends station XML
  and transport commands only — never credentials or personal data.
- Cleartext to arbitrary hosts is enabled because speakers are addressed by
  dynamic private IPs; see
  `resources/android/xml/network_security_config.xml` for the reasoning and a
  commented domain-config tightening path for stable-hostname deployments.
- The shell runs from `file://` (see "Why AndroidInsecureFileModeEnabled"
  above) — chosen over any mixed-content escape hatch because cordova-android@15
  ships none, and the file origin keeps speaker traffic outside browser
  mixed-content policy while the network security config stays the OS-level
  gatekeeper.
- CSP lives in `www/index.html`: scripts may come only from the local shell and
  `https://makatumba.github.io`; `connect-src` additionally allows the pinned
  Radio Browser API host and protocol-wide `http/ws` for LAN speakers;
  `img-src`/`media-src` are wide because station artwork and stream hosts are
  user-contributed third-party origins. `unsafe-eval` is intentionally absent —
  only add it back if a device test proves the toolchain needs it.
- `<allow-navigation>` is restricted to GitHub Pages: the app window can never
  navigate to a speaker or third-party site; those origins are reachable only
  as network requests.
