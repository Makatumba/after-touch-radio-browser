import {state, setModalSyncHook} from './app';
import type {State} from './state';
import {getLabels} from './i18n';
import {renderSettings} from './components/settings';
import {renderSoundtouchSettings} from './components/soundtouch';

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
    const hideToggle = document.querySelector<HTMLInputElement>('#settingHideRemoteSkipButtons');
    if (hideToggle) hideToggle.checked = s.settings.hideRemoteSkipButtons;
    const langSelect = document.querySelector<HTMLSelectElement>('#settingLanguage');
    if (langSelect) langSelect.value = s.language;
}

/** Wave 6: re-labels the preserved popup in place after a language change
 * (NO node replacement — the popup keeps its node and never replays its
 * entrance animation). No-op while the popup is closed. */
export function relabelSettingsModal(s: State): void {
    const overlay = document.querySelector(OVERLAY_SELECTOR);
    if (!overlay) return;
    const t = getLabels(s);
    const title = document.querySelector('.modal-header h2');
    if (title) title.textContent = t.settingsTitle;
    const langLabel = document.querySelector('label[for="settingLanguage"]');
    if (langLabel) langLabel.textContent = t.settingLanguage;
    const previewLabel = document.getElementById('settingEnablePreviewLabel');
    if (previewLabel) previewLabel.textContent = t.settingEnablePreview;
    const hideLabel = document.getElementById('settingHideRemoteSkipButtonsLabel');
    if (hideLabel) hideLabel.textContent = t.settingHideRemoteSkipButtons;
    const resetBtn = document.getElementById('resetSettings');
    if (resetBtn) resetBtn.textContent = t.resetDefaults;
}

/** Wave 7: re-renders ONLY the preserved popup's SoundTouch section with the
 * current state (host, live status, hints, device info) — the popup keeps its
 * node and never replays its entrance animation (no-blink contract). No-op
 * while the popup is closed. */
export function syncSettingsModalSoundtouch(s: State): void {
    const section = document.querySelector<HTMLElement>('.soundtouch-section');
    if (!section) return;
    section.outerHTML = renderSoundtouchSettings(s, getLabels(s));
}

// registered once at module load: every render() that re-inserts the open
// popup re-syncs the section in place (settings-modal imports state from
// './app', so app.ts evaluates first — no cycle, no TDZ)
setModalSyncHook(() => syncSettingsModalSoundtouch(state));
