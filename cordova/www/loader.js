/*
 * After Touch Radio Browser — Cordova shell loader.
 *
 * Boots the LOCAL Cordova document by fetching the current hashed frontend
 * assets from GitHub Pages, driven by a stable runtime manifest:
 *   https://makatumba.github.io/after-touch-radio-browser/app-assets.json
 *
 * Contract (mirrors scripts/emit-app-assets.ts in the web repo):
 *   { "version": "YYYY.MM.DD.HHMM", "css": ["assets/…css"], "js": ["assets/…js"] }
 *
 * Security model: the manifest is executable-code metadata. Every asset URL is
 * resolved against MANIFEST_URL and must land on ALLOWED_ORIGIN before it is
 * injected — a compromised or tampered manifest cannot point this shell at an
 * arbitrary script origin. The manifest itself is fetched with cache:'no-store'
 * plus a query cache-buster so each cold launch picks up the current deploy.
 */
(function () {
    'use strict';

    var MANIFEST_URL = 'https://makatumba.github.io/after-touch-radio-browser/app-assets.json';
    var ALLOWED_ORIGIN = 'https://makatumba.github.io';
    /** Fallback window when cordova.js never fires deviceready (browser dev). */
    var DEVICE_READY_FALLBACK_MS = 1500;

    // Boot state machine: at most one boot attempt may be in flight, and the
    // timeout fallback must never race or duplicate a deviceready-triggered
    // boot (hasBooted latches success; started latches an in-flight attempt).
    var hasBooted = false;
    var started = false;
    // The remote entry module executes the app exactly once per document;
    // re-injecting it on a later retry would double-initialize global state,
    // so after a successful JS load the only safe retry is a full reload.
    var entryScriptExecuted = false;

    var injected = [];

    function element(id) {
        return document.getElementById(id);
    }

    function setMessage(message) {
        var el = element('boot-message');
        if (el) el.textContent = message;
    }

    function showRetry(show, reloadMode) {
        var el = element('boot-retry');
        if (!el) return;
        el.hidden = !show;
        el.textContent = show && reloadMode ? 'Reload app' : 'Retry';
    }

    function resolveAsset(relativePath) {
        var url = new URL(relativePath, MANIFEST_URL);
        if (url.origin !== ALLOWED_ORIGIN) {
            throw new Error('Refusing asset outside approved origin: ' + url.origin);
        }
        return url.href;
    }

    function removeInjectedAssets() {
        for (var i = 0; i < injected.length; i++) {
            if (injected[i] && injected[i].parentNode) {
                injected[i].parentNode.removeChild(injected[i]);
            }
        }
        injected = [];
    }

    function loadStyle(url) {
        return new Promise(function (resolve, reject) {
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = url;
            link.onload = function () { resolve(); };
            link.onerror = function () { reject(new Error('Could not load stylesheet: ' + url)); };
            injected.push(link);
            document.head.appendChild(link);
        });
    }

    function loadScript(url) {
        return new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            // The web build is a Vite ES module bundle: module injection keeps
            // its relative imports resolving against its own (GitHub Pages)
            // URL. Do not switch to a classic script without changing builds.
            script.type = 'module';
            script.src = url;
            script.onload = function () { resolve(); };
            script.onerror = function () { reject(new Error('Could not load app script: ' + url)); };
            injected.push(script);
            document.body.appendChild(script);
        });
    }

    function readManifest() {
        var cacheBusterUrl = MANIFEST_URL + '?t=' + Date.now();
        return fetch(cacheBusterUrl, {cache: 'no-store'}).then(function (response) {
            if (!response.ok) {
                throw new Error('Could not fetch the application manifest (HTTP ' + response.status + '). Check your internet connection.');
            }
            return response.json();
        }).then(function (manifest) {
            if (!manifest || !Array.isArray(manifest.css) || !Array.isArray(manifest.js) || manifest.js.length === 0) {
                throw new Error('The application manifest has an invalid shape.');
            }
            return manifest;
        });
    }

    function boot() {
        if (hasBooted || started) return Promise.resolve();
        started = true;
        showRetry(false);

        var finish = function () {
            started = false;
        };

        return readManifest()
            .then(function (manifest) {
                setMessage('Loading app version ' + manifest.version + '…');
                var styles = manifest.css.reduce(function (chain, relativePath) {
                    return chain.then(function () {
                        return loadStyle(resolveAsset(relativePath));
                    });
                }, Promise.resolve());
                return styles.then(function () {
                    return manifest.js.reduce(function (chain, relativePath) {
                        return chain.then(function () {
                            return loadScript(resolveAsset(relativePath));
                        });
                    }, Promise.resolve());
                });
            })
            .then(function () {
                entryScriptExecuted = true;
                hasBooted = true;
                // Marks the document as booted for external observers and
                // neutralizes the deviceready timeout fallback.
                document.documentElement.setAttribute('data-after-touch-started', 'true');
                var shell = element('boot');
                if (shell && shell.parentNode) shell.parentNode.removeChild(shell);
                started = false;
            })
            .catch(function (error) {
                started = false;
                if (window.console && window.console.error) {
                    window.console.error('[After Touch loader]', error);
                }
                setMessage(error instanceof Error ? error.message : 'The app could not be loaded.');
                showRetry(true, entryScriptExecuted);
            });
    }

    function onRetry() {
        if (entryScriptExecuted) {
            // The remote app already owns this document — a clean reload is
            // the only safe retry (re-injecting the entry module would run the
            // app's initialization twice).
            window.location.reload();
            return;
        }
        removeInjectedAssets();
        boot();
    }

    function start() {
        var retryEl = element('boot-retry');
        if (retryEl) retryEl.addEventListener('click', onRetry);
        document.addEventListener('deviceready', function () { boot(); }, {once: true});
        window.setTimeout(function () {
            if (!hasBooted && !started) boot();
        }, DEVICE_READY_FALLBACK_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, {once: true});
    } else {
        start();
    }
})();
