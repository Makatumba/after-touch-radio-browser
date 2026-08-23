import type { Settings } from './state';

const LS_SETTINGS = 'radio-browser-settings';
// Wave 12 migration: loadSettings deliberately reads the SoundTouch host key
// here — a cross-key read (the host is NOT part of the settings JSON).
const LS_SOUNDTOUCH_HOST = 'radio-browser-soundtouch-host';

export const defaultSettings: Settings = {
    enablePreview: false,
    hideRemoteSkipButtons: true,
    enableSpeakerControl: false,
};

/** Wave 12 migration fallback for stored settings WITHOUT a boolean
 * enableSpeakerControl key (present-JSON-missing-key, non-boolean values, and
 * a wholly missing settings entry alike): the context decides — a non-empty
 * saved host means an existing working setup keeps its remote across the
 * update (on); an empty or absent host stays browse-only (off). */
function migratedEnableSpeakerControl(): boolean {
    return !!localStorage.getItem(LS_SOUNDTOUCH_HOST);
}

export function loadSettings(): Settings {
    try {
        const raw = localStorage.getItem(LS_SETTINGS);
        // wholly missing entry (the common pre-wave-12 state): the two older
        // keys fall back to defaults while the new boolean migrates contextually
        if (!raw) return { ...defaultSettings, enableSpeakerControl: migratedEnableSpeakerControl() };
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return {
            enablePreview: parsed.enablePreview === true,
            // only an explicit boolean false disables the hiding; legacy and
            // corrupt values fall back to the default (hidden)
            hideRemoteSkipButtons: parsed.hideRemoteSkipButtons !== false,
            // an existing boolean always wins; an absent or non-boolean value
            // falls back contextually via the saved-host read above. Corrupt
            // JSON never reaches this line — the catch below returns plain
            // defaults (browse-only), never the contextual migration.
            enableSpeakerControl:
                typeof parsed.enableSpeakerControl === 'boolean'
                    ? parsed.enableSpeakerControl
                    : migratedEnableSpeakerControl(),
        };
    } catch {
        return { ...defaultSettings };
    }
}

export function saveSettings(settings: Settings): void {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
}
