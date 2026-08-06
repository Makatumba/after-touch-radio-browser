import {state} from './app';
import type {State} from './state';
import {renderSettings} from './components/settings';

const OVERLAY_SELECTOR = '.modal-overlay';

/** Mounts the settings popup inside #app without re-rendering the shell —
 * the station list, artwork, and player bar stay untouched (no-blink
 * contract). Idempotent: a rapid second open never double-mounts. */
export function mountSettingsModal(s: State): void {
    if (document.querySelector(OVERLAY_SELECTOR)) return;
    const app = document.querySelector('#app');
    if (!app) return;
    app.insertAdjacentHTML('beforeend', renderSettings(s));
    s.showSettings = true;
    document.getElementById('closeSettings')?.focus();
}

/** Unmounts only the popup; the page behind it is never rebuilt. Focus
 * returns to the gear button (×, backdrop click, and Esc all land here). */
export function unmountSettingsModal(): void {
    const overlay = document.querySelector(OVERLAY_SELECTOR);
    if (overlay) overlay.remove();
    state.showSettings = false;
    document.getElementById('openSettings')?.focus();
}

/** Re-syncs the preserved popup's controls with state after an action that
 * changed settings without rebuilding the popup (e.g. reset to defaults). */
export function syncSettingsModalState(s: State): void {
    const toggle = document.querySelector<HTMLInputElement>('#settingEnablePreview');
    if (toggle) toggle.checked = s.settings.enablePreview;
}
