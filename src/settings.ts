import type { Settings } from './state';

const LS_SETTINGS = 'radio-browser-settings';

export const defaultSettings: Settings = {
    disablePlayer: false,
    disablePlayButton: false,
    soundtouchDefault: false,
};

export function loadSettings(): Settings {
    try {
        const raw = localStorage.getItem(LS_SETTINGS);
        return raw ? { ...defaultSettings, ...JSON.parse(raw) } : { ...defaultSettings };
    } catch {
        return { ...defaultSettings };
    }
}

export function saveSettings(settings: Settings): void {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
}
