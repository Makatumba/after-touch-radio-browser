import type { Settings } from './state';

const LS_SETTINGS = 'radio-browser-settings';

export const defaultSettings: Settings = {
    enablePreview: false,
    hideRemoteSkipButtons: true,
};

export function loadSettings(): Settings {
    try {
        const raw = localStorage.getItem(LS_SETTINGS);
        if (!raw) return { ...defaultSettings };
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return {
            enablePreview: parsed.enablePreview === true,
            // only an explicit boolean false disables the hiding; legacy and
            // corrupt values fall back to the default (hidden)
            hideRemoteSkipButtons: parsed.hideRemoteSkipButtons !== false,
        };
    } catch {
        return { ...defaultSettings };
    }
}

export function saveSettings(settings: Settings): void {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
}
