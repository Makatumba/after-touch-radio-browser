/**
 * Runtime environment detection (Cordova wrapper vs browser/PWA).
 *
 * The Android Cordova shell (sibling project after-touch-radio-browser-cordova)
 * boots from a LOCAL index.html that sets `window.__AFTER_TOUCH_RUNTIME__ =
 * 'cordova'` before loader.js injects this remote bundle. This helper is the
 * single source of truth for "am I inside the native wrapper?".
 *
 * A function (not an import-time constant) on purpose: cordova.js injects the
 * `cordova` global asynchronously, so live reads stay correct even when the
 * flag script was absent (development fallback) and the global appears later.
 *
 * Current consumers: none besides the boot marker in main.ts — FR-8 ships no
 * offline shell and no browser-install code (pinned by
 * tests/pwa-assets.test.ts), so there are no PWA-only registration points to
 * gate today. Any FUTURE offline-cache registration or browser-install logic
 * MUST consult this helper and stay disabled under the Cordova runtime.
 */
export function isCordovaRuntime(): boolean {
    const scope = globalThis as {
        __AFTER_TOUCH_RUNTIME__?: string;
        cordova?: unknown;
    };
    return scope.__AFTER_TOUCH_RUNTIME__ === 'cordova' || typeof scope.cordova !== 'undefined';
}
