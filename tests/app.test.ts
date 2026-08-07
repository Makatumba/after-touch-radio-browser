import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error the repo has no @types/node; node:fs is available at runtime via vitest
import fs from 'node:fs';
import { App, render, state } from '../src/app';
import { getLabels, translations } from '../src/i18n';
import { defaultSettings, loadSettings } from '../src/settings';
import { setupEvents } from '../src/events';
import { getAudioElement } from '../src/player';
import type { State, Station } from '../src/state';

const LS_LANGUAGE = 'radio-browser-language';
const LS_SOUNDTOUCH = 'radio-browser-soundtouch-host';
const LS_FAVORITES = 'radio-browser-favorites';
const LS_SETTINGS = 'radio-browser-settings';

const STATION: Station = {
    stationuuid: 'abc-123-def',
    name: 'Test FM',
    url: 'http://stream.example.com/old.mp3',
    url_resolved: 'http://stream.example.com/live.mp3',
    country: 'Germany',
    language: 'english',
    codec: 'MP3',
    bitrate: 128,
    lastcheckok: true,
};

// The five sort keys land with the sortable-results feature (FR-1 extension).
type SortKey = 'name_asc' | 'name_desc' | 'clickcount' | 'clicktrend' | 'votes';
// Station.clicktrend lands with the same feature; include it so favorites with
// and without numeric fields are both covered before src/state.ts gains it.
type SortableStation = Partial<Station> & { clicktrend?: number };
// state.sort is added with the same feature. Until src/state.ts gains the
// property, access it through this typed view so the tests stay type-clean.
const sortView = state as unknown as { sort: SortKey };

// Wave 6: Settings gains hideRemoteSkipButtons; until src/state.ts +
// src/settings.ts change, tests read it through this typed view.
const settingsView = state as unknown as {
    settings: { enablePreview: boolean; hideRemoteSkipButtons: boolean };
};

// The settings-modal API is added with the wave-5 settings-popup feature; the
// cast keeps this file type-clean while src/settings-modal.ts does not exist
// yet. A computed specifier (+ @vite-ignore) stops vite:import-analysis from
// failing the whole file on the unresolved module, and the stub fallback turns
// the RED into plain assertions (the popup simply never mounts) instead of a
// load error — the real module replaces the stub once it exists.
type SettingsModalApi = {
    mountSettingsModal: (s: State) => void;
    unmountSettingsModal: () => void;
    syncSettingsModalState: (s: State) => void;
};

async function loadSettingsModal(): Promise<SettingsModalApi> {
    const specifier = '../src/settings-modal';
    try {
        return (await import(/* @vite-ignore */ specifier)) as unknown as SettingsModalApi;
    } catch {
        return {
            mountSettingsModal: () => {},
            unmountSettingsModal: () => {},
            syncSettingsModalState: () => {},
        };
    }
}

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    // the language-select E2E tests write documentElement.lang via setLanguage;
    // reset it so the value never leaks into other tests
    document.documentElement.lang = 'en';
    state.language = 'en';
    state.showSettings = false;
    state.skippedSetup = false;
    state.deviceMessage = '';
    // REQUIRED: without an address App() renders the setup view and every
    // shell/footer assertion fails.
    state.soundtouchAddress = '192.168.1.42';
    state.soundtouchStatus = 'available';
    state.settings = { ...defaultSettings };
    state.stations = [];
    state.favorites = [];
    state.mode = 'top';
    sortView.sort = 'clickcount';
    for (const key of [LS_LANGUAGE, LS_SOUNDTOUCH, LS_FAVORITES, LS_SETTINGS]) {
        localStorage.removeItem(key);
    }
    getAudioElement().removeAttribute('src');
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (navigator as unknown as { language?: string }).language;
});

describe('app', () => {
    it('exports App and renders buttons', () => {
        render();
        expect(App()).toContain('Search stations');
        // Wave 6: the header is brand + gear only — the inline language
        // switcher (chips + "Active language" label) moved into the popup.
        expect(document.querySelector('.lang-switcher-inline')).toBeNull();
        expect(document.querySelector('[data-lang]')).toBeNull();
        expect(document.querySelector('#app')!.textContent).not.toContain('Active language');
        expect(document.getElementById('openSettings')).not.toBeNull();
    });
    it('includes translations', () => {
        expect(translations.ru.search).toContain('Искать');
        expect(translations.ukr.search).toContain('Шукати');
    });

    describe('footer', () => {
        // Hardcoded expected sentence per language (NOT derived from any placeholder).
        const FOOTER_STRINGS: Record<string, string> = {
            en: 'Station data by Radio Browser',
            de: 'Senderdaten von Radio Browser',
            ru: 'Данные о станциях предоставляет Radio Browser',
            ukr: 'Дані про станції надає Radio Browser',
        };

        it('renders a footer inside the app shell', () => {
            render();
            const footer = document.querySelector('.app-shell > footer.footer');
            expect(footer).not.toBeNull();
            expect(App()).toContain('<footer class="footer">');
        });

        it('wraps only the Radio Browser brand in an anchor with the exact contract', () => {
            render();
            const footer = document.querySelector<HTMLElement>('.app-shell > footer.footer');
            expect(footer).not.toBeNull();
            const links = footer!.querySelectorAll('a');
            expect(links.length).toBe(1);
            const link = links[0];
            expect(link.getAttribute('href')).toBe('https://www.radio-browser.info/');
            expect(link.getAttribute('target')).toBe('_blank');
            expect(link.getAttribute('rel')).toBe('noopener');
            expect(link.id).toBe('');
            for (let i = 0; i < link.attributes.length; i++) {
                expect(link.attributes[i].name.startsWith('data-')).toBe(false);
            }
            expect(link.textContent).toBe('Radio Browser');
        });

        it('localizes the footer sentence for every language', () => {
            for (const lang of ['en', 'de', 'ru', 'ukr'] as const) {
                state.language = lang;
                render();
                const footer = document.querySelector<HTMLElement>('.app-shell > footer.footer');
                expect(footer).not.toBeNull();
                expect(footer!.textContent!.trim()).toBe(FOOTER_STRINGS[lang]);
                const link = footer!.querySelector('a');
                expect(link).not.toBeNull();
                expect(link!.textContent).toBe('Radio Browser');
            }
        });

        it('has footerAttribution in all languages with identical key sets', () => {
            for (const lang of ['en', 'de', 'ru', 'ukr'] as const) {
                expect(translations[lang].footerAttribution).toBeTruthy();
            }
            for (const lang of ['de', 'ru', 'ukr'] as const) {
                expect(Object.keys(translations[lang])).toEqual(Object.keys(translations.en));
            }
            expect(Object.keys(translations.de)).toEqual(Object.keys(translations.en));
        });

        it('keeps the persistent audio node across re-renders', () => {
            // Wave 1: the player bar is gated on the preview setting, so the
            // persistence contract is asserted with preview enabled.
            state.settings.enablePreview = true;
            render();
            const audio1 = document.querySelector('.player #audio-widget');
            expect(audio1).not.toBeNull();
            render();
            const audio2 = document.querySelector('.player #audio-widget');
            expect(audio2).not.toBeNull();
            expect(audio1).toBe(audio2);
            expect(document.querySelector('.app-shell > footer.footer')).not.toBeNull();
        });

        it('renders the footer when the in-browser player is hidden', () => {
            // Wave 1: the player bar is hidden whenever preview is disabled (default).
            render();
            expect(document.querySelector('.app-shell > footer.footer')).not.toBeNull();
            expect(document.querySelector('.player')).toBeNull();
            expect(document.querySelector('#audio-widget')).toBeNull();
        });

        it('renders the footer with the settings modal open', async () => {
            // Wave 5: the modal is mounted explicitly and survives a
            // background render instead of being re-rendered from App().
            const { mountSettingsModal } = await loadSettingsModal();
            mountSettingsModal(state);
            const overlay = document.querySelector('.modal-overlay');
            expect(overlay).not.toBeNull();
            render();
            expect(document.querySelector('.modal-overlay')).toBe(overlay);
            expect(document.querySelector('.app-shell > footer.footer')).not.toBeNull();
        });

        it('renders the footer in every mode', () => {
            for (const mode of ['top', 'recent', 'search', 'favorites'] as const) {
                state.mode = mode;
                render();
                expect(document.querySelector('.app-shell > footer.footer')).not.toBeNull();
            }
        });
    });
});

describe('setup view (FR-2)', () => {
    it('renders a full-screen setup view when no address is saved', () => {
        state.soundtouchAddress = '';
        state.skippedSetup = false;
        render();
        const setup = document.querySelector('.setup-view');
        expect(setup).not.toBeNull();
        expect(setup!.textContent).toContain(getLabels(state).setupIntro);
        expect(setup!.querySelector('#soundtouch')).not.toBeNull();
        expect(setup!.querySelector('#saveSoundtouch')).not.toBeNull();
        expect(setup!.querySelector('#skipSetup')).not.toBeNull();
        expect(document.querySelector('.app-shell')).toBeNull();
        expect(document.querySelector('.station-list')).toBeNull();
        expect(document.querySelector('footer')).toBeNull();
    });

    it('does not render the setup view when an address is saved', () => {
        state.soundtouchAddress = '192.168.1.42';
        state.skippedSetup = false;
        render();
        expect(document.querySelector('.setup-view')).toBeNull();
        expect(document.querySelector('.app-shell')).not.toBeNull();
        expect(document.querySelector('footer')).not.toBeNull();
    });

    it('renders the app shell when setup was skipped', () => {
        state.soundtouchAddress = '';
        state.skippedSetup = true;
        render();
        expect(document.querySelector('.setup-view')).toBeNull();
        expect(document.querySelector('.app-shell')).not.toBeNull();
        expect(document.querySelector('.station-list')).not.toBeNull();
    });

    it('skips setup when the skip link is clicked', () => {
        state.soundtouchAddress = '';
        state.skippedSetup = false;
        render();
        setupEvents();
        const skip = document.querySelector<HTMLElement>('#skipSetup');
        expect(skip).not.toBeNull();
        skip!.click();
        expect(state.skippedSetup).toBe(true);
    });

    it.each<[string, string]>([
        ['http://192.168.1.42/', '192.168.1.42'],
        ['https://MySpeaker.local', 'MySpeaker.local'],
        [' 192.168.1.42 ', '192.168.1.42'],
        ['192.168.1.42:8090/path?x="', '192.168.1.42:8090'],
        ['<script>alert(1)</script>', ''],
        ['http://', ''],
    ])('sanitizeHost(%j) === %j', async (raw, expected) => {
        const { sanitizeHost } = await import('../src/actions');
        expect(sanitizeHost(raw)).toBe(expected);
    });

    it('saves the sanitized address and verifies reachability', async () => {
        // The no-cors probe resolves with an opaque response — that alone
        // proves the device Web API on port 8090 answers.
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        state.soundtouchAddress = '';
        state.skippedSetup = false;
        render();
        setupEvents();

        expect(document.querySelector('.setup-view')).not.toBeNull();
        const input = document.querySelector<HTMLInputElement>('#soundtouch')!;
        input.value = 'http://192.168.1.42/';
        document.querySelector<HTMLButtonElement>('#saveSoundtouch')!.click();

        await vi.waitFor(() => expect(state.soundtouchAddress).toBe('192.168.1.42'), { timeout: 500 });
        await vi.waitFor(() => expect(state.soundtouchStatus).toBe('available'), { timeout: 500 });
        expect(localStorage.getItem(LS_SOUNDTOUCH)).toBe('192.168.1.42');
        expect(document.querySelector('.setup-view')).toBeNull();
        // wave 7: the status no longer renders in the shell — the config moved
        // into the settings popup, so the shell carries no .soundtouch-bar
        expect(document.querySelector('.soundtouch-bar')).toBeNull();
        // reachability is visible only inside the settings popup: open it and
        // assert the live status text (the state transition itself is pinned
        // by the waitFor above)
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const status = document.querySelector<HTMLElement>('.modal-overlay .soundtouch-status');
        expect(status).not.toBeNull();
        expect(status!.textContent).toContain(`✓ ${getLabels(state).reachable}`);
        // Probe-only check: exactly one no-cors GET on the device Web API.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://192.168.1.42:8090/info');
        expect(init.mode).toBe('no-cors');
    });

    it('marks the device unreachable and shows the banner when the check fails', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
        vi.stubGlobal('fetch', fetchMock);

        state.soundtouchAddress = '';
        state.skippedSetup = false;
        render();
        setupEvents();

        const input = document.querySelector<HTMLInputElement>('#soundtouch')!;
        input.value = '192.168.1.42';
        document.querySelector<HTMLButtonElement>('#saveSoundtouch')!.click();

        await vi.waitFor(() => expect(state.soundtouchStatus).toBe('unreachable'), { timeout: 500 });
        // The single probe rejects, so the check makes exactly one attempt.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(document.querySelector('.setup-view')).toBeNull();
        await vi.waitFor(() => expect(document.querySelector('.offline-banner')).not.toBeNull(), { timeout: 500 });
        expect(document.querySelector('.offline-banner')!.textContent).toContain(getLabels(state).offlineBanner);
    });
});

describe('play on speaker (FR-4)', () => {
    it('labels the primary card action with the play-on-speaker text', () => {
        state.stations = [STATION];
        render();
        const btn = document.querySelector<HTMLButtonElement>('[data-play]');
        expect(btn).not.toBeNull();
        expect(btn!.textContent).toContain(getLabels(state).playOnSpeaker);
    });

    it('removes the separate send-to-soundtouch button', () => {
        state.stations = [STATION];
        render();
        expect(document.querySelector('[data-send]')).toBeNull();
    });

    it('drops the obsolete translation keys in all languages', () => {
        for (const lang of ['en', 'de', 'ru', 'ukr'] as const) {
            const t = getLabels({ language: lang });
            expect(t.send).toBeUndefined();
            expect(t.play).toBeUndefined();
            expect(t.settingDisablePlayer).toBeUndefined();
            expect(t.settingDisablePlayButton).toBeUndefined();
            expect(t.settingSoundtouchDefault).toBeUndefined();
            expect(t.playingOnSpeaker).toBeUndefined();
        }
    });

    it('disables the primary action with a hint when no address is saved', () => {
        state.soundtouchAddress = '';
        state.skippedSetup = true;
        state.stations = [STATION];
        render();
        const btn = document.querySelector<HTMLButtonElement>('[data-play]');
        expect(btn).not.toBeNull();
        expect(btn!.disabled).toBe(true);
        expect(btn!.title).toBe(getLabels(state).unconfiguredHint);
    });

    it('disables the primary action with a hint when the device is offline', () => {
        state.soundtouchAddress = '192.168.1.42';
        state.soundtouchStatus = 'unreachable';
        state.stations = [STATION];
        render();
        const btn = document.querySelector<HTMLButtonElement>('[data-play]');
        expect(btn).not.toBeNull();
        expect(btn!.disabled).toBe(true);
        expect(btn!.title).toBe(getLabels(state).offlineHint);
    });

    it('enables the primary action when the device is reachable', () => {
        state.soundtouchAddress = '192.168.1.42';
        state.soundtouchStatus = 'available';
        state.stations = [STATION];
        render();
        const btn = document.querySelector<HTMLButtonElement>('[data-play]');
        expect(btn).not.toBeNull();
        expect(btn!.disabled).toBe(false);
    });

    it('sends the station to the speaker and shows a confirmation', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetchMock);
        const playSpy = vi.spyOn(HTMLAudioElement.prototype, 'play').mockResolvedValue(undefined);
        vi.spyOn(HTMLAudioElement.prototype, 'pause').mockImplementation(() => {});
        vi.spyOn(HTMLAudioElement.prototype, 'load').mockImplementation(() => {});

        state.soundtouchAddress = '192.168.1.42';
        state.soundtouchStatus = 'available';
        state.stations = [STATION];
        render();
        setupEvents();

        document.querySelector<HTMLButtonElement>('[data-play]')!.click();

        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 500 });
        const url = fetchMock.mock.calls[0][0] as string;
        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect(url).toMatch(/:8090\/select$/);
        expect(init.method).toBe('POST');
        expect(new Headers(init.headers as HeadersInit).get('Content-Type')).toBe('text/plain;charset=UTF-8');
        expect(String(init.body)).toContain('stationurl');
        expect(String(init.body)).toContain(STATION.stationuuid);
        await vi.waitFor(
            () =>
                expect(state.deviceMessage).toBe(
                    getLabels(state).sendingToSpeaker
                        .replace('{station}', STATION.name)
                        .replace('{device}', state.soundtouchDevice?.name ?? state.soundtouchAddress)
                ),
            { timeout: 500 }
        );
        expect(state.soundtouchStatus).toBe('available');
        expect(playSpy).not.toHaveBeenCalled();
    });

    it('marks the device unreachable when the send fails', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(HTMLAudioElement.prototype, 'pause').mockImplementation(() => {});
        vi.spyOn(HTMLAudioElement.prototype, 'load').mockImplementation(() => {});

        state.soundtouchAddress = '192.168.1.42';
        state.soundtouchStatus = 'available';
        state.stations = [STATION];
        render();
        setupEvents();

        document.querySelector<HTMLButtonElement>('[data-play]')!.click();

        await vi.waitFor(() => expect(state.soundtouchStatus).toBe('unreachable'), { timeout: 500 });
        expect(state.deviceMessage).toBe(getLabels(state).sendFailed);
        await vi.waitFor(() => expect(document.querySelector('.offline-banner')).not.toBeNull(), { timeout: 500 });
        expect(document.querySelector('.offline-banner')!.textContent).toContain(getLabels(state).offlineBanner);
    });

    it('plays favorites straight to the speaker via the primary action', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(HTMLAudioElement.prototype, 'pause').mockImplementation(() => {});
        vi.spyOn(HTMLAudioElement.prototype, 'load').mockImplementation(() => {});

        state.mode = 'favorites';
        state.soundtouchAddress = '192.168.1.42';
        state.soundtouchStatus = 'available';
        state.stations = [STATION];
        state.favorites = [STATION];
        render();
        setupEvents();

        document.querySelector<HTMLButtonElement>('[data-play]')!.click();

        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 500 });
        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect(String(init.body)).toContain(STATION.stationuuid);
    });

    it('does nothing when the disabled primary action is clicked', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(HTMLAudioElement.prototype, 'pause').mockImplementation(() => {});
        vi.spyOn(HTMLAudioElement.prototype, 'load').mockImplementation(() => {});
        const playSpy = vi.spyOn(HTMLAudioElement.prototype, 'play').mockResolvedValue(undefined);

        state.soundtouchAddress = '';
        state.skippedSetup = true;
        state.soundtouchStatus = 'available';
        state.stations = [STATION];
        render();
        setupEvents();

        document.querySelector<HTMLButtonElement>('[data-play]')!.click();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(playSpy).not.toHaveBeenCalled();
    });
});

describe('preview playback (FR-5)', () => {
    it('hides preview actions and the player bar by default', () => {
        state.stations = [STATION];
        render();
        expect(document.querySelector('[data-preview]')).toBeNull();
        expect(document.querySelector('.player')).toBeNull();
        expect(document.querySelector('#audio-widget')).toBeNull();
    });

    it('shows preview actions and the player bar when preview is enabled', () => {
        state.settings.enablePreview = true;
        state.stations = [STATION];
        render();
        expect(document.querySelector('[data-preview]')).not.toBeNull();
        expect(document.querySelector('.player')).not.toBeNull();
        expect(document.querySelector('#audio-widget')).not.toBeNull();
    });

    it('previews the station in the browser without touching the device', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const playSpy = vi.spyOn(HTMLAudioElement.prototype, 'play').mockResolvedValue(undefined);
        vi.spyOn(HTMLAudioElement.prototype, 'pause').mockImplementation(() => {});
        vi.spyOn(HTMLAudioElement.prototype, 'load').mockImplementation(() => {});

        state.settings.enablePreview = true;
        state.soundtouchAddress = '192.168.1.42';
        state.soundtouchStatus = 'available';
        state.deviceMessage = '';
        state.stations = [STATION];
        render();
        setupEvents();

        const previewBtn = document.querySelector<HTMLButtonElement>('[data-preview]');
        expect(previewBtn).not.toBeNull();
        previewBtn!.click();

        await vi.waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1), { timeout: 500 });
        const audio = document.querySelector<HTMLAudioElement>('#audio-widget');
        expect(audio).not.toBeNull();
        expect(audio!.src).toBe(STATION.url_resolved);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(state.soundtouchStatus).toBe('available');
        expect(state.deviceMessage).toBe('');
    });

    it('stops preview audio when preview is toggled off', async () => {
        vi.spyOn(HTMLAudioElement.prototype, 'play').mockResolvedValue(undefined);
        vi.spyOn(HTMLAudioElement.prototype, 'pause').mockImplementation(() => {});
        vi.spyOn(HTMLAudioElement.prototype, 'load').mockImplementation(() => {});

        state.settings.enablePreview = true;
        state.stations = [STATION];
        render();
        setupEvents();

        const previewBtn = document.querySelector<HTMLButtonElement>('[data-preview]');
        expect(previewBtn).not.toBeNull();
        previewBtn!.click();
        await vi.waitFor(() => expect(getAudioElement().getAttribute('src')).not.toBeNull(), { timeout: 500 });

        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const toggle = document.querySelector<HTMLInputElement>('#settingEnablePreview');
        expect(toggle).not.toBeNull();
        toggle!.checked = false;
        toggle!.dispatchEvent(new Event('change', { bubbles: true }));

        expect(state.settings.enablePreview).toBe(false);
        expect(getAudioElement().hasAttribute('src')).toBe(false);
        expect(document.querySelector('.player')).toBeNull();
    });

    it('reset stops preview audio when preview was enabled', async () => {
        vi.spyOn(HTMLAudioElement.prototype, 'play').mockResolvedValue(undefined);
        vi.spyOn(HTMLAudioElement.prototype, 'pause').mockImplementation(() => {});
        vi.spyOn(HTMLAudioElement.prototype, 'load').mockImplementation(() => {});

        state.settings.enablePreview = true;
        state.stations = [STATION];
        render();
        setupEvents();

        const previewBtn = document.querySelector<HTMLButtonElement>('[data-preview]');
        expect(previewBtn).not.toBeNull();
        previewBtn!.click();
        await vi.waitFor(() => expect(getAudioElement().getAttribute('src')).not.toBeNull(), { timeout: 500 });

        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const resetBtn = document.querySelector<HTMLButtonElement>('#resetSettings');
        expect(resetBtn).not.toBeNull();
        resetBtn!.click();

        expect(state.settings).toEqual({ enablePreview: false, hideRemoteSkipButtons: true });
        expect(JSON.parse(localStorage.getItem(LS_SETTINGS)!)).toEqual({ enablePreview: false, hideRemoteSkipButtons: true });
        expect(getAudioElement().hasAttribute('src')).toBe(false);
        expect(document.querySelector('.player')).toBeNull();
    });
});

describe('settings (FR-10)', () => {
    it('loads enablePreview from stored settings and ignores legacy keys', () => {
        localStorage.setItem(
            LS_SETTINGS,
            JSON.stringify({
                disablePlayer: true,
                disablePlayButton: true,
                soundtouchDefault: true,
                enablePreview: true,
            })
        );
        expect(loadSettings()).toEqual({ enablePreview: true, hideRemoteSkipButtons: true });
    });

    it('defaults enablePreview to false when only legacy keys are stored', () => {
        localStorage.setItem(LS_SETTINGS, JSON.stringify({ disablePlayer: true }));
        expect(loadSettings()).toEqual({ enablePreview: false, hideRemoteSkipButtons: true });
    });

    it('rejects a non-boolean enablePreview value', () => {
        localStorage.setItem(LS_SETTINGS, JSON.stringify({ enablePreview: 'yes' }));
        expect(loadSettings()).toEqual({ enablePreview: false, hideRemoteSkipButtons: true });
    });

    it('falls back to defaults on corrupt JSON', () => {
        localStorage.setItem(LS_SETTINGS, '{corrupt');
        expect(loadSettings()).toEqual({ enablePreview: false, hideRemoteSkipButtons: true });
    });

    it('loads hideRemoteSkipButtons=false when stored false', () => {
        localStorage.setItem(LS_SETTINGS, JSON.stringify({ enablePreview: true, hideRemoteSkipButtons: false }));
        expect(loadSettings()).toEqual({ enablePreview: true, hideRemoteSkipButtons: false });
    });

    it('ignores a corrupt hideRemoteSkipButtons value (defaults to true)', () => {
        localStorage.setItem(LS_SETTINGS, JSON.stringify({ enablePreview: false, hideRemoteSkipButtons: 'false' }));
        expect(loadSettings()).toEqual({ enablePreview: false, hideRemoteSkipButtons: true });
    });

    it('renders exactly two toggles and one language select in the settings modal', async () => {
        // Wave 5: the popup is mounted explicitly rather than baked into App().
        // Wave 6: the popup gains the hideRemoteSkipButtons toggle and the
        // language select next to the existing enablePreview toggle.
        const { mountSettingsModal } = await loadSettingsModal();
        mountSettingsModal(state);
        const toggles = document.querySelectorAll('.modal-body input[type="checkbox"]');
        expect(toggles.length).toBe(2);
        const previewToggle = document.querySelector<HTMLInputElement>('#settingEnablePreview');
        expect(previewToggle).not.toBeNull();
        expect(previewToggle!.parentElement!.textContent).toContain(getLabels(state).settingEnablePreview);
        expect(document.querySelector('#settingHideRemoteSkipButtons')).not.toBeNull();
        const select = document.querySelector<HTMLSelectElement>('#settingLanguage');
        expect(select).not.toBeNull();
        expect(select!.tagName).toBe('SELECT');
        expect([...select!.options].map(o => o.value)).toEqual(['en', 'de', 'ru', 'ukr']);
        expect([...select!.options].map(o => o.textContent)).toEqual(['English', 'Deutsch', 'Русский', 'Українська']);
        const selected = [...select!.options].filter(o => o.selected);
        expect(selected.length).toBe(1);
        expect(selected[0].value).toBe(state.language);
        expect(document.querySelector('#settingDisablePlayer')).toBeNull();
        expect(document.querySelector('#settingDisablePlayButton')).toBeNull();
        expect(document.querySelector('#settingSoundtouchDefault')).toBeNull();
    });

    it('reset restores default settings and persists them', async () => {
        const { mountSettingsModal } = await loadSettingsModal();
        mountSettingsModal(state);
        render();
        setupEvents();

        const toggle = document.querySelector<HTMLInputElement>('#settingEnablePreview');
        expect(toggle).not.toBeNull();
        toggle!.checked = true;
        toggle!.dispatchEvent(new Event('change', { bubbles: true }));
        expect(state.settings.enablePreview).toBe(true);

        document.querySelector<HTMLButtonElement>('#resetSettings')!.click();
        expect(state.settings).toEqual({ enablePreview: false, hideRemoteSkipButtons: true });
        expect(JSON.parse(localStorage.getItem(LS_SETTINGS)!)).toEqual({ enablePreview: false, hideRemoteSkipButtons: true });
        // Wave 5: reset also syncs the open popup's checkbox (syncSettingsModalState).
        expect(document.querySelector<HTMLInputElement>('#settingEnablePreview')!.checked).toBe(false);
    });
});

describe('language auto-detect (FR-9)', () => {
    it.each<[string, string]>([
        ['uk', 'ukr'],
        ['uk-UA', 'ukr'],
        ['en-US', 'en'],
        ['de', 'de'],
        ['ru', 'ru'],
        ['fr-FR', 'en'],
        ['', 'en'],
    ])('detectLanguage(%j) === %j', async (locale, expected) => {
        const { detectLanguage } = await import('../src/i18n');
        expect(detectLanguage(locale)).toBe(expected);
    });

    it('auto-detects the language from navigator.language on first run', async () => {
        localStorage.removeItem(LS_LANGUAGE);
        Object.defineProperty(navigator, 'language', { value: 'uk-UA', configurable: true });
        const { initLanguage } = await import('../src/app');
        expect(initLanguage()).toBe('ukr');
        expect(localStorage.getItem(LS_LANGUAGE)).toBe('ukr');
    });

    it('keeps a manually saved language override', async () => {
        localStorage.setItem(LS_LANGUAGE, 'de');
        Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
        const { initLanguage } = await import('../src/app');
        expect(initLanguage()).toBe('de');
        expect(localStorage.getItem(LS_LANGUAGE)).toBe('de');
    });

    it('switches the language from the settings-popup select', () => {
        state.stations = [STATION];
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const overlay = document.querySelector('.modal-overlay');
        const panel = document.querySelector('.modal-panel');
        const list = document.querySelector('.station-list');
        expect(overlay).not.toBeNull();
        expect(panel).not.toBeNull();
        expect(list).not.toBeNull();
        const select = document.querySelector<HTMLSelectElement>('#settingLanguage');
        expect(select).not.toBeNull();

        select!.value = 'de';
        select!.dispatchEvent(new Event('change', { bubbles: true }));

        // the whole UI re-labels, exactly like the old chips did
        expect(state.language).toBe('de');
        expect(localStorage.getItem(LS_LANGUAGE)).toBe('de');
        expect(document.documentElement.lang).toBe('de');
        expect(document.querySelector('header h1')!.textContent).toBe(getLabels({ language: 'de' }).title);
        // the open popup re-labels in place (relabelSettingsModal), node preserved
        expect(document.querySelector<HTMLElement>('.modal-header h2')!.textContent).toBe(getLabels({ language: 'de' }).settingsTitle);
        const previewLabel = document.getElementById('settingEnablePreviewLabel');
        expect(previewLabel).not.toBeNull();
        expect(previewLabel!.textContent).toBe(getLabels({ language: 'de' }).settingEnablePreview);
        expect(document.getElementById('resetSettings')!.textContent).toBe(getLabels({ language: 'de' }).resetDefaults);
        // no-blink contract: the popup and the station list keep their nodes
        expect(document.querySelector('.modal-overlay')).toBe(overlay);
        expect(document.querySelector('.modal-panel')).toBe(panel);
        expect(document.querySelector('.station-list')).toBe(list);
        expect(document.activeElement).toBe(document.getElementById('settingLanguage'));
    });

    it('a language change never writes the settings JSON', () => {
        state.stations = [STATION];
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const select = document.querySelector<HTMLSelectElement>('#settingLanguage');
        expect(select).not.toBeNull();
        const before = localStorage.getItem(LS_SETTINGS);

        select!.value = 'de';
        select!.dispatchEvent(new Event('change', { bubbles: true }));

        expect(state.language).toBe('de');
        expect(localStorage.getItem(LS_LANGUAGE)).toBe('de');
        // the language persists under its own key — never inside the settings JSON
        expect(localStorage.getItem(LS_SETTINGS)).toBe(before);
    });

    it('reset restores both settings defaults and leaves the language untouched', () => {
        state.stations = [STATION];
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const select = document.querySelector<HTMLSelectElement>('#settingLanguage');
        expect(select).not.toBeNull();
        select!.value = 'de';
        select!.dispatchEvent(new Event('change', { bubbles: true }));
        expect(state.language).toBe('de');

        document.querySelector<HTMLButtonElement>('#resetSettings')!.click();

        // the language is never part of reset
        expect(state.language).toBe('de');
        expect(localStorage.getItem(LS_LANGUAGE)).toBe('de');
        expect(select!.value).toBe('de');
        // both settings restore their defaults
        expect(state.settings).toEqual({ enablePreview: false, hideRemoteSkipButtons: true });
        const hideToggle = document.querySelector<HTMLInputElement>('#settingHideRemoteSkipButtons');
        expect(hideToggle).not.toBeNull();
        expect(hideToggle!.checked).toBe(true);
    });

    it('rapid language switching keeps the popup node and the last selection wins', () => {
        state.stations = [STATION];
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const overlay = document.querySelector('.modal-overlay');
        expect(overlay).not.toBeNull();
        const select = document.querySelector<HTMLSelectElement>('#settingLanguage');
        expect(select).not.toBeNull();

        select!.value = 'de';
        select!.dispatchEvent(new Event('change', { bubbles: true }));
        select!.value = 'ru';
        select!.dispatchEvent(new Event('change', { bubbles: true }));

        expect(state.language).toBe('ru');
        expect(localStorage.getItem(LS_LANGUAGE)).toBe('ru');
        expect(document.querySelector('.modal-overlay')).toBe(overlay);
        expect(document.querySelector<HTMLElement>('.modal-header h2')!.textContent).toBe(getLabels({ language: 'ru' }).settingsTitle);
    });

    it('a fresh settings popup open has no no-anim class (entrance animation plays)', () => {
        state.stations = [STATION];
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const overlay = document.querySelector('.modal-overlay');
        expect(overlay).not.toBeNull();
        // a fresh mount must NOT carry the class — only preserved re-insertions
        // get it, so the entrance animation still plays on open
        expect(overlay!.classList.contains('modal-overlay--no-anim')).toBe(false);
    });

    it('a language change marks the preserved popup as no-anim (never replays its entrance animation)', () => {
        state.stations = [STATION];
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const overlay = document.querySelector('.modal-overlay');
        expect(overlay).not.toBeNull();
        const select = document.querySelector<HTMLSelectElement>('#settingLanguage');
        expect(select).not.toBeNull();

        select!.value = 'de';
        select!.dispatchEvent(new Event('change', { bubbles: true }));

        expect(state.language).toBe('de');
        expect(document.querySelector('.modal-overlay')).toBe(overlay);
        expect(document.querySelector('.modal-overlay')!.classList.contains('modal-overlay--no-anim')).toBe(true);
    });

    it('a background render while the popup is open marks the preserved popup as no-anim and keeps the node', () => {
        state.stations = [STATION];
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const overlay = document.querySelector('.modal-overlay');
        expect(overlay).not.toBeNull();

        // direct render() simulates the artwork-settle hook path
        // (setRenderHook(render) in src/app.ts)
        render();

        expect(document.querySelector('.modal-overlay')).toBe(overlay);
        expect(document.querySelector('.modal-overlay')!.classList.contains('modal-overlay--no-anim')).toBe(true);
    });

    it('adds settingLanguage and settingHideRemoteSkipButtons in all languages and drops active', () => {
        const tView = translations as unknown as Record<string, Record<string, string>>;
        for (const lang of ['en', 'de', 'ru', 'ukr'] as const) {
            expect(tView[lang].settingLanguage?.trim()).toBeTruthy();
            expect(tView[lang].settingHideRemoteSkipButtons?.trim()).toBeTruthy();
            expect(tView[lang].active).toBeUndefined();
        }
    });
});

describe('logo and branding (FR-12)', () => {
    it('shows the brand logo with alt text next to the title in the header', () => {
        render();
        const img = document.querySelector<HTMLImageElement>('header .brand-mark');
        expect(img).not.toBeNull();
        expect(img!.tagName).toBe('IMG');
        expect(img!.getAttribute('src')).toBe('logo.png');
        expect(img!.getAttribute('alt')).toBe(getLabels(state).logoAlt);
        expect(img!.getAttribute('alt')).toBeTruthy();
        expect(img!.getAttribute('width')).toBe('48');
        expect(img!.getAttribute('height')).toBe('48');
        const h1 = document.querySelector('header h1');
        expect(h1).not.toBeNull();
        expect(h1!.textContent).toBe(getLabels(state).title);
    });

    it('references the logo as a relative favicon in index.html', () => {
        // NOTE: Vite's transform rewrites `new URL(rel, import.meta.url)` against the
        // dev-server origin, so the repo root is derived from the file URL instead.
        const repoRoot = import.meta.url.slice(0, import.meta.url.lastIndexOf('/tests/') + 1);
        const html = fs.readFileSync(new URL('index.html', repoRoot), 'utf8');
        expect(html).toMatch(/<link[^>]*rel="icon"[^>]*>/);
        expect(html).toContain('href="logo.png"');
        expect(html).not.toMatch(/href="\/logo\.png"/);
    });
});

describe('sortable search results & favorites (FR-1 extension)', () => {
    it('renders the sort select in the filters panel with the five options in display order', () => {
        render();
        const select = document.querySelector<HTMLSelectElement>('#sort');
        expect(select).not.toBeNull();
        expect(select!.tagName).toBe('SELECT');
        expect([...select!.options].map(o => o.value)).toEqual([
            'name_asc',
            'name_desc',
            'clickcount',
            'clicktrend',
            'votes',
        ]);
        // Sits in the filters panel after the limit select.
        const controls = [...document.querySelectorAll<HTMLSelectElement>('.controls select')].map(s => s.id);
        expect(controls.indexOf('limit')).toBeGreaterThanOrEqual(0);
        expect(controls.indexOf('limit')).toBeLessThan(controls.indexOf('sort'));
    });

    it('labels the sort select with t.sortBy', () => {
        render();
        const select = document.querySelector<HTMLSelectElement>('#sort');
        expect(select).not.toBeNull();
        expect(select!.parentElement!.textContent).toContain(getLabels(state).sortBy);
    });

    it('marks the current state.sort as the selected option', () => {
        render();
        let selected = [...document.querySelector<HTMLSelectElement>('#sort')!.options].filter(o => o.selected);
        expect(selected.length).toBe(1);
        expect(selected[0].value).toBe('clickcount');

        sortView.sort = 'votes';
        render();
        selected = [...document.querySelector<HTMLSelectElement>('#sort')!.options].filter(o => o.selected);
        expect(selected.length).toBe(1);
        expect(selected[0].value).toBe('votes');
    });

    it('localizes the five sort option labels in all languages', () => {
        for (const lang of ['de', 'ru', 'ukr'] as const) {
            state.language = lang;
            render();
            const select = document.querySelector<HTMLSelectElement>('#sort')!;
            const labels = getLabels({ language: lang });
            expect([...select.options].map(o => o.textContent)).toEqual([
                labels.sortNameAsc,
                labels.sortNameDesc,
                labels.sortPopular,
                labels.sortTrending,
                labels.sortTopVotes,
            ]);
            expect(select.parentElement!.textContent).toContain(labels.sortBy);
        }
    });

    describe('compareFavorites (client-side favorites sorting)', () => {
        async function loadCompareFavorites() {
            // compareFavorites is added with the sortable-favorites feature; the
            // cast keeps this file type-clean while the export does not exist yet.
            return (await import('../src/actions')) as unknown as {
                compareFavorites: (a: SortableStation, b: SortableStation, sort: SortKey, locale: string) => number;
            };
        }

        it('name_asc uses localeCompare with the active locale', async () => {
            const { compareFavorites } = await loadCompareFavorites();
            expect(compareFavorites({ name: 'Äpfel' }, { name: 'Apfel' }, 'name_asc', 'de')).toBe(
                'Äpfel'.localeCompare('Apfel', 'de')
            );
            expect(compareFavorites({ name: 'Apfel' }, { name: 'Äpfel' }, 'name_asc', 'de')).toBe(
                'Apfel'.localeCompare('Äpfel', 'de')
            );
        });

        it('name_desc negates the localeCompare result', async () => {
            const { compareFavorites } = await loadCompareFavorites();
            expect(compareFavorites({ name: 'Äpfel' }, { name: 'Apfel' }, 'name_desc', 'de')).toBe(
                -'Äpfel'.localeCompare('Apfel', 'de')
            );
            expect(compareFavorites({ name: 'Apfel' }, { name: 'Äpfel' }, 'name_desc', 'de')).toBe(
                -'Apfel'.localeCompare('Äpfel', 'de')
            );
        });

        it('treats a missing name as an empty string', async () => {
            const { compareFavorites } = await loadCompareFavorites();
            expect(compareFavorites({}, { name: 'Zeta' }, 'name_asc', 'en')).toBe(''.localeCompare('Zeta', 'en'));
            expect(compareFavorites({ name: 'Zeta' }, {}, 'name_asc', 'en')).toBe('Zeta'.localeCompare('', 'en'));
            expect(compareFavorites({}, {}, 'name_asc', 'en')).toBe(0);
        });

        it.each<[('clickcount' | 'clicktrend' | 'votes'), SortableStation, SortableStation]>([
            ['clickcount', { clickcount: 10 }, { clickcount: 3 }],
            ['clicktrend', { clicktrend: 10 }, { clicktrend: 3 }],
            ['votes', { votes: 10 }, { votes: 3 }],
        ])('%s compares descending with missing values as 0', async (key, big, small) => {
            const { compareFavorites } = await loadCompareFavorites();
            expect(compareFavorites(big, small, key, 'en')).toBe(-7);
            expect(compareFavorites(small, big, key, 'en')).toBe(7);
            expect(compareFavorites(big, {}, key, 'en')).toBe(-10);
            expect(compareFavorites({}, big, key, 'en')).toBe(10);
        });

        it('returns 0 for equal keys so the sort stays stable', async () => {
            const { compareFavorites } = await loadCompareFavorites();
            expect(compareFavorites({ clickcount: 7 }, { clickcount: 7 }, 'clickcount', 'en')).toBe(0);
            expect(compareFavorites({ clicktrend: 7 }, { clicktrend: 7 }, 'clicktrend', 'en')).toBe(0);
            expect(compareFavorites({ votes: 7 }, { votes: 7 }, 'votes', 'en')).toBe(0);
            expect(compareFavorites({ name: 'same' }, { name: 'same' }, 'name_asc', 'en')).toBe(0);
        });
    });
});

describe('settings popup fixes (wave 5)', () => {
    it('renders the gear as a Material-style SVG icon with the unchanged title', () => {
        render();
        const gear = document.getElementById('openSettings');
        expect(gear).not.toBeNull();
        const svg = gear!.querySelector('svg');
        expect(svg).not.toBeNull();
        expect(svg!.getAttribute('viewBox')).toBe('0 0 24 24');
        expect(svg!.getAttribute('fill')).toBe('currentColor');
        expect(svg!.getAttribute('aria-hidden')).toBe('true');
        expect(svg!.getAttribute('focusable')).toBe('false');
        expect(gear!.innerHTML).not.toContain('⚙');
        expect(gear!.innerHTML).not.toContain('&#9881;');
        expect(gear!.id).toBe('openSettings');
        expect(gear!.getAttribute('title')).toBe(getLabels(state).settingsTitle);
    });

    it('opens the popup without replacing the station-list node', () => {
        state.stations = [STATION];
        render();
        setupEvents();
        const list = document.querySelector('.station-list');
        expect(list).not.toBeNull();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        expect(document.querySelector('.modal-overlay')).not.toBeNull();
        expect(state.showSettings).toBe(true);
        expect(document.querySelector('.station-list')).toBe(list);
    });

    it('toggling the preview switch preserves the popup and syncs the player bar', () => {
        state.stations = [STATION];
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const overlay = document.querySelector('.modal-overlay');
        const panel = document.querySelector('.modal-panel');
        const list = document.querySelector('.station-list');
        expect(overlay).not.toBeNull();
        expect(panel).not.toBeNull();
        const toggle = document.querySelector<HTMLInputElement>('#settingEnablePreview');
        expect(toggle).not.toBeNull();

        toggle!.checked = true;
        toggle!.dispatchEvent(new Event('change', { bubbles: true }));
        expect(document.querySelector('.modal-overlay')).toBe(overlay);
        expect(document.querySelector('.modal-panel')).toBe(panel);
        expect(document.querySelector('.station-list')).toBe(list);
        expect(document.querySelector('.player')).not.toBeNull();
        expect(state.settings).toEqual({ enablePreview: true, hideRemoteSkipButtons: true });
        expect(JSON.parse(localStorage.getItem(LS_SETTINGS)!)).toEqual({ enablePreview: true, hideRemoteSkipButtons: true });

        toggle!.checked = false;
        toggle!.dispatchEvent(new Event('change', { bubbles: true }));
        expect(document.querySelector('.modal-overlay')).toBe(overlay);
        expect(document.querySelector('.modal-panel')).toBe(panel);
        expect(document.querySelector('.station-list')).toBe(list);
        expect(document.querySelector('.player')).toBeNull();
        expect(state.settings).toEqual({ enablePreview: false, hideRemoteSkipButtons: true });
        expect(JSON.parse(localStorage.getItem(LS_SETTINGS)!)).toEqual({ enablePreview: false, hideRemoteSkipButtons: true });
    });

    it('enabling preview shows the cards preview buttons without rebuilding the shell', () => {
        state.stations = [STATION];
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const overlay = document.querySelector('.modal-overlay');
        const panel = document.querySelector('.modal-panel');
        const list = document.querySelector('.station-list');
        expect(overlay).not.toBeNull();
        expect(panel).not.toBeNull();
        expect(list).not.toBeNull();
        // preview is off by default — the cards carry no data-preview buttons
        expect(document.querySelector('[data-preview]')).toBeNull();

        const toggle = document.querySelector<HTMLInputElement>('#settingEnablePreview');
        expect(toggle).not.toBeNull();
        toggle!.checked = true;
        toggle!.dispatchEvent(new Event('change', { bubbles: true }));
        expect(document.querySelector('.player')).not.toBeNull();
        expect(document.querySelector('[data-preview]')).not.toBeNull();
        expect(document.querySelector<HTMLElement>('[data-preview]')!.dataset.preview).toBe(STATION.stationuuid);
        // the popup and the station list keep their nodes (no-blink contract)
        expect(document.querySelector('.modal-overlay')).toBe(overlay);
        expect(document.querySelector('.modal-panel')).toBe(panel);
        expect(document.querySelector('.station-list')).toBe(list);

        toggle!.checked = false;
        toggle!.dispatchEvent(new Event('change', { bubbles: true }));
        expect(document.querySelector('.player')).toBeNull();
        // no stale buttons left on the cards
        expect(document.querySelector('[data-preview]')).toBeNull();
        expect(document.querySelector('.station-list')).toBe(list);
    });

    it('reset removes the preview buttons when preview was enabled', () => {
        state.stations = [STATION];
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const overlay = document.querySelector('.modal-overlay');
        expect(overlay).not.toBeNull();
        const toggle = document.querySelector<HTMLInputElement>('#settingEnablePreview');
        expect(toggle).not.toBeNull();
        toggle!.checked = true;
        toggle!.dispatchEvent(new Event('change', { bubbles: true }));
        expect(document.querySelector('[data-preview]')).not.toBeNull();
        expect(document.querySelector('.player')).not.toBeNull();

        document.querySelector<HTMLButtonElement>('#resetSettings')!.click();

        expect(document.querySelector('[data-preview]')).toBeNull();
        expect(document.querySelector('.player')).toBeNull();
        expect(state.settings).toEqual({ enablePreview: false, hideRemoteSkipButtons: true });
        // reset must not rebuild the popup
        expect(document.querySelector('.modal-overlay')).toBe(overlay);
    });

    it('closes via ×, backdrop click, and Escape without rebuilding the page', () => {
        state.stations = [STATION];
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const list = document.querySelector('.station-list');
        expect(list).not.toBeNull();

        // × closes
        document.querySelector<HTMLButtonElement>('#closeSettings')!.click();
        expect(document.querySelector('.modal-overlay')).toBeNull();
        expect(state.showSettings).toBe(false);
        expect(document.querySelector('.station-list')).toBe(list);

        // backdrop click closes
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        expect(document.querySelector('.modal-overlay')).not.toBeNull();
        document.getElementById('settingsOverlay')!.click();
        expect(document.querySelector('.modal-overlay')).toBeNull();
        expect(state.showSettings).toBe(false);

        // a click on the panel does not close
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        expect(document.querySelector('.modal-overlay')).not.toBeNull();
        document.querySelector<HTMLElement>('.modal-panel')!.click();
        expect(document.querySelector('.modal-overlay')).not.toBeNull();
        expect(state.showSettings).toBe(true);

        // Escape closes
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.querySelector('.modal-overlay')).toBeNull();
        expect(state.showSettings).toBe(false);
        expect(document.querySelector('.station-list')).toBe(list);

        // Escape with the popup closed is a no-op
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.querySelector('.modal-overlay')).toBeNull();
        expect(state.showSettings).toBe(false);
    });

    it('a background render leaves the popup mounted and un-rebuilt', () => {
        state.stations = [STATION];
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const overlay = document.querySelector('.modal-overlay');
        const panel = document.querySelector('.modal-panel');
        expect(overlay).not.toBeNull();
        render();
        expect(document.querySelector('.modal-overlay')).toBe(overlay);
        expect(document.querySelector('.modal-panel')).toBe(panel);
        expect(state.showSettings).toBe(true);
    });

    it('moves focus to the close button on open and back to the gear on close', () => {
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        expect(document.activeElement).toBe(document.getElementById('closeSettings'));
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.activeElement).toBe(document.getElementById('openSettings'));
    });
});

describe('settings expansion (wave 6)', () => {
    it('toggling skip-hiding surgically replaces only the remote panel', () => {
        state.stations = [STATION];
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const remotePanel = document.querySelector('.remote-panel');
        const overlay = document.querySelector('.modal-overlay');
        const panel = document.querySelector('.modal-panel');
        const list = document.querySelector('.station-list');
        expect(remotePanel).not.toBeNull();
        expect(overlay).not.toBeNull();
        expect(panel).not.toBeNull();

        const hideToggle = document.querySelector<HTMLInputElement>('#settingHideRemoteSkipButtons');
        expect(hideToggle).not.toBeNull();
        expect(hideToggle!.checked).toBe(true);
        hideToggle!.checked = false;
        hideToggle!.dispatchEvent(new Event('change', { bubbles: true }));

        expect(settingsView.settings.hideRemoteSkipButtons).toBe(false);
        expect(JSON.parse(localStorage.getItem(LS_SETTINGS)!)).toEqual({ enablePreview: false, hideRemoteSkipButtons: false });
        // syncRemotePanel replaces ONLY the remote panel — the popup and the
        // station list keep their nodes (no-blink contract)
        expect(document.querySelector('.remote-panel')).not.toBe(remotePanel);
        expect(document.querySelector('#remoteNext')).not.toBeNull();
        expect(document.querySelector('#remotePrev')).not.toBeNull();
        expect(document.querySelector('.modal-overlay')).toBe(overlay);
        expect(document.querySelector('.modal-panel')).toBe(panel);
        expect(document.querySelector('.station-list')).toBe(list);
    });

    it('reset restores skip-hiding in the settings and the remote', () => {
        state.stations = [STATION];
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const hideToggle = document.querySelector<HTMLInputElement>('#settingHideRemoteSkipButtons');
        expect(hideToggle).not.toBeNull();
        hideToggle!.checked = false;
        hideToggle!.dispatchEvent(new Event('change', { bubbles: true }));
        expect(document.querySelector('#remoteNext')).not.toBeNull();

        document.querySelector<HTMLButtonElement>('#resetSettings')!.click();

        expect(settingsView.settings).toEqual({ enablePreview: false, hideRemoteSkipButtons: true });
        expect(JSON.parse(localStorage.getItem(LS_SETTINGS)!)).toEqual({ enablePreview: false, hideRemoteSkipButtons: true });
        // the preserved popup's controls sync to the restored defaults
        expect(document.querySelector<HTMLInputElement>('#settingHideRemoteSkipButtons')!.checked).toBe(true);
        expect(document.querySelector('#remoteNext')).toBeNull();
    });
});

describe('remote panel header device info (wave 7.1)', () => {
    // the file's shared beforeEach does not reset soundtouchDevice (AGENTS.md
    // convention) — every test starts from a known-good null device so widget
    // presence is pinned per test, never leaked from an earlier one
    beforeEach(() => {
        state.soundtouchDevice = null;
    });

    it('renders no device-info widget and keeps the header intact when no device is known', () => {
        render();
        expect(document.querySelector('.remote-head .soundtouch-info')).toBeNull();
        expect(document.querySelector('.remote-head h2')).not.toBeNull();
        expect(document.querySelector('.remote-head .remote-status')).not.toBeNull();
    });

    it('shows the device-info widget in the remote header when a device is known', () => {
        state.soundtouchDevice = { id: '689E19B8BB8A', name: 'Bose SoundTouch B9B8BC', type: 'SoundTouch 10' };
        render();
        const widget = document.querySelector<HTMLElement>('.remote-head .soundtouch-info');
        expect(widget).not.toBeNull();
        expect(widget!.parentElement!.classList.contains('remote-head')).toBe(true);
        expect(widget!.querySelector('summary')!.textContent).toBe('ℹ');
        const body = widget!.querySelector<HTMLElement>('.soundtouch-info-body');
        expect(body).not.toBeNull();
        expect(body!.textContent).toContain(getLabels(state).deviceName);
        expect(body!.textContent).toContain('Bose SoundTouch B9B8BC');
        expect(document.querySelector<HTMLElement>('.remote-head h2')!.textContent).toBe(getLabels(state).remoteTitle);
        expect(document.querySelector('.remote-head .remote-status')).not.toBeNull();
    });

    it('keeps the header device-info widget while reconnecting or unreachable', () => {
        state.soundtouchDevice = { id: '689E19B8BB8A', name: 'Bose SoundTouch B9B8BC', type: 'SoundTouch 10' };
        render();
        expect(document.querySelector('.remote-head .soundtouch-info')).not.toBeNull();

        state.wsStatus = 'reconnecting';
        render();
        expect(document.querySelector('.remote-head .soundtouch-info')).not.toBeNull();

        state.soundtouchStatus = 'unreachable';
        render();
        expect(document.querySelector('.remote-head .soundtouch-info')).not.toBeNull();
    });

    it('a background render keeps the header device-info widget and the popup node', () => {
        state.soundtouchDevice = { id: '689E19B8BB8A', name: 'Bose SoundTouch B9B8BC', type: 'SoundTouch 10' };
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const overlay = document.querySelector('.modal-overlay');
        expect(overlay).not.toBeNull();
        expect(document.querySelector('.remote-head .soundtouch-info')).not.toBeNull();

        // direct render() simulates the artwork-settle hook path
        render();

        expect(document.querySelector('.modal-overlay')).toBe(overlay);
        expect(document.querySelector('.remote-head .soundtouch-info')).not.toBeNull();
    });

    it('toggling skip-hiding rebuilds the remote panel with the device-info widget and keeps the popup', () => {
        state.soundtouchDevice = { id: '689E19B8BB8A', name: 'Bose SoundTouch B9B8BC', type: 'SoundTouch 10' };
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const overlay = document.querySelector('.modal-overlay');
        const remotePanel = document.querySelector('.remote-panel');
        const widget = document.querySelector<HTMLElement>('.remote-head .soundtouch-info');
        expect(overlay).not.toBeNull();
        expect(remotePanel).not.toBeNull();
        expect(widget).not.toBeNull();

        const hideToggle = document.querySelector<HTMLInputElement>('#settingHideRemoteSkipButtons');
        expect(hideToggle).not.toBeNull();
        hideToggle!.checked = false;
        hideToggle!.dispatchEvent(new Event('change', { bubbles: true }));

        // syncRemotePanel replaces ONLY the remote panel — the header widget
        // comes along with the fresh panel and the popup keeps its node
        expect(document.querySelector('.remote-panel')).not.toBe(remotePanel);
        expect(document.querySelector('.remote-head .soundtouch-info')).not.toBeNull();
        expect(document.querySelector('.modal-overlay')).toBe(overlay);
    });
});

describe('soundtouch settings section (wave 7)', () => {
    it('renders no SoundTouch bar in the shell when an address is saved', () => {
        state.soundtouchAddress = '192.168.1.42';
        render();
        // wave 7: the whole config block moved into the settings popup — the
        // shell keeps only the Remote panel
        expect(document.querySelector('.soundtouch-bar')).toBeNull();
        expect(document.querySelector('.remote-panel')).not.toBeNull();
    });

    it('persists a NEW address when a saved one is changed', async () => {
        // Regression pin: the save handler used to persist only on first
        // setup or clearing, so changing a previously saved address left the
        // old host in storage. Saving must always persist the new host.
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        state.soundtouchAddress = '192.168.1.42';
        state.skippedSetup = false;
        localStorage.setItem(LS_SOUNDTOUCH, '192.168.1.42');
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();

        const input = document.querySelector<HTMLInputElement>('#settingSoundtouchHost');
        expect(input).not.toBeNull();
        input!.value = 'http://192.168.1.43/';
        document.querySelector<HTMLButtonElement>('#settingSoundtouchSave')!.click();

        expect(state.soundtouchAddress).toBe('192.168.1.43');
        expect(localStorage.getItem(LS_SOUNDTOUCH)).toBe('192.168.1.43');
        // the probe runs to completion so the reachability check settles
        expect(state.soundtouchStatus).toBe('checking');
        await vi.waitFor(() => expect(state.soundtouchStatus).toBe('available'), { timeout: 500 });
    });

    it('the settings popup renders the SoundTouch connection section', () => {
        state.soundtouchAddress = '192.168.1.42';
        state.stations = [STATION];
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const overlay = document.querySelector('.modal-overlay');
        const panel = document.querySelector('.modal-panel');
        expect(overlay).not.toBeNull();
        expect(panel).not.toBeNull();

        const hostInput = document.querySelector<HTMLInputElement>('#settingSoundtouchHost');
        expect(hostInput).not.toBeNull();
        expect(hostInput!.value).toBe('192.168.1.42');
        expect(document.querySelector('#settingSoundtouchSave')).not.toBeNull();
        const status = document.querySelector<HTMLElement>('.soundtouch-status');
        expect(status).not.toBeNull();
        expect(status!.textContent).toContain(`✓ ${getLabels(state).reachable}`);

        // a language switch re-labels the section in place while the popup
        // keeps its nodes (no-blink contract)
        const select = document.querySelector<HTMLSelectElement>('#settingLanguage');
        expect(select).not.toBeNull();
        select!.value = 'de';
        select!.dispatchEvent(new Event('change', { bubbles: true }));

        const de = getLabels({ language: 'de' });
        expect(document.querySelector<HTMLInputElement>('#settingSoundtouchHost')!.value).toBe('192.168.1.42');
        expect(document.querySelector<HTMLButtonElement>('#settingSoundtouchSave')!.textContent).toBe(de.save);
        expect(document.querySelector<HTMLElement>('.soundtouch-status')!.textContent).toContain(`✓ ${de.reachable}`);
        expect(document.querySelector('.modal-overlay')).toBe(overlay);
        expect(document.querySelector('.modal-panel')).toBe(panel);
    });

    it('saving a host from the popup preserves the popup and updates the status in place', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        state.soundtouchAddress = '';
        state.skippedSetup = true;
        state.soundtouchStatus = 'idle';
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const overlay = document.querySelector('.modal-overlay');
        const panel = document.querySelector('.modal-panel');
        expect(overlay).not.toBeNull();
        expect(panel).not.toBeNull();

        const input = document.querySelector<HTMLInputElement>('#settingSoundtouchHost');
        expect(input).not.toBeNull();
        input!.value = 'http://192.168.1.43/';
        document.querySelector<HTMLButtonElement>('#settingSoundtouchSave')!.click();

        // the popup keeps its nodes and never replays its entrance animation
        expect(document.querySelector('.modal-overlay')).toBe(overlay);
        expect(document.querySelector('.modal-panel')).toBe(panel);
        expect(document.querySelector('.modal-overlay')!.classList.contains('modal-overlay--no-anim')).toBe(true);
        // the status flips to Checking… live in place
        expect(state.soundtouchAddress).toBe('192.168.1.43');
        expect(localStorage.getItem(LS_SOUNDTOUCH)).toBe('192.168.1.43');
        const status = document.querySelector<HTMLElement>('.soundtouch-status');
        expect(status).not.toBeNull();
        expect(status!.textContent).toContain(`⟳ ${getLabels(state).checking}`);

        // the probe resolves → Reachable in place, Remote panel appears behind
        await vi.waitFor(() => expect(state.soundtouchStatus).toBe('available'), { timeout: 500 });
        expect(document.querySelector<HTMLElement>('.soundtouch-status')!.textContent).toContain(`✓ ${getLabels(state).reachable}`);
        expect(document.querySelector('.remote-panel')).not.toBeNull();
        // the probe hit the device Web API exactly like the old shell bar
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://192.168.1.43:8090/info');
        expect(init.mode).toBe('no-cors');
    });

    it('clearing the host from the popup disconnects and keeps the popup open', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        state.soundtouchAddress = '192.168.1.42';
        state.skippedSetup = true;
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const overlay = document.querySelector('.modal-overlay');
        expect(overlay).not.toBeNull();
        expect(document.querySelector('.remote-panel')).not.toBeNull();

        const input = document.querySelector<HTMLInputElement>('#settingSoundtouchHost');
        expect(input).not.toBeNull();
        input!.value = '';
        document.querySelector<HTMLButtonElement>('#settingSoundtouchSave')!.click();

        expect(state.soundtouchAddress).toBe('');
        expect(localStorage.getItem(LS_SOUNDTOUCH)).toBe('');
        expect(document.querySelector<HTMLElement>('.soundtouch-status')!.textContent).toBe('—');
        // the Remote panel disappears behind the still-open popup
        expect(document.querySelector('.remote-panel')).toBeNull();
        expect(document.querySelector('.modal-overlay')).toBe(overlay);
        expect(state.showSettings).toBe(true);
    });

    it('reset to defaults keeps the saved host', () => {
        state.soundtouchAddress = '192.168.1.42';
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const overlay = document.querySelector('.modal-overlay');
        expect(overlay).not.toBeNull();
        const input = document.querySelector<HTMLInputElement>('#settingSoundtouchHost');
        expect(input).not.toBeNull();
        expect(input!.value).toBe('192.168.1.42');

        document.querySelector<HTMLButtonElement>('#resetSettings')!.click();

        // reset touches only the two toggles — the host (like the language)
        // is never reset
        expect(state.soundtouchAddress).toBe('192.168.1.42');
        expect(document.querySelector<HTMLInputElement>('#settingSoundtouchHost')!.value).toBe('192.168.1.42');
        expect(state.settings).toEqual({ enablePreview: false, hideRemoteSkipButtons: true });
        expect(document.querySelector('.modal-overlay')).toBe(overlay);
    });

    it('a background render keeps the popup SoundTouch section live without animation replay', () => {
        state.soundtouchAddress = '192.168.1.42';
        state.stations = [STATION];
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const overlay = document.querySelector('.modal-overlay');
        expect(overlay).not.toBeNull();
        const section = document.querySelector('.soundtouch-section');
        expect(section).not.toBeNull();

        // direct render() simulates the artwork-settle hook path
        state.soundtouchStatus = 'unreachable';
        render();

        expect(document.querySelector('.modal-overlay')).toBe(overlay);
        expect(document.querySelector('.modal-overlay')!.classList.contains('modal-overlay--no-anim')).toBe(true);
        // the section syncs in place — replaced with the fresh status
        const sectionAfter = document.querySelector('.soundtouch-section');
        expect(sectionAfter).not.toBeNull();
        expect(sectionAfter).not.toBe(section);
        expect(sectionAfter!.querySelector('.soundtouch-status')!.textContent).toContain(`✗ ${getLabels(state).unreachable}`);

        state.deviceMessage = 'test msg';
        render();
        expect(document.querySelector('.modal-overlay')).toBe(overlay);
        const hint = document.querySelector<HTMLElement>('.modal-overlay .soundtouch-hint');
        expect(hint).not.toBeNull();
        expect(hint!.textContent).toBe('test msg');
    });

    it('ignores a stale ping result after the address changes', async () => {
        let rejectA!: (reason: Error) => void;
        // A's probe hangs (never resolves on its own) until the test rejects it.
        const pendingA = new Promise<Response>((_, reject) => {
            rejectA = reject;
        });
        const fetchMock = vi
            .fn()
            .mockImplementationOnce(() => pendingA)
            .mockImplementationOnce(() => Promise.resolve({} as Response))
            .mockRejectedValue(new Error('offline'));
        vi.stubGlobal('fetch', fetchMock);

        state.soundtouchAddress = '192.168.1.42';
        state.skippedSetup = false;
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();

        // Save host A — its reachability ping stays pending.
        let input = document.querySelector<HTMLInputElement>('#settingSoundtouchHost');
        expect(input).not.toBeNull();
        input!.value = 'http://192.168.1.42/';
        document.querySelector<HTMLButtonElement>('#settingSoundtouchSave')!.click();

        // Save host B — its probe resolves immediately.
        input = document.querySelector<HTMLInputElement>('#settingSoundtouchHost');
        expect(input).not.toBeNull();
        input!.value = '192.168.1.99';
        document.querySelector<HTMLButtonElement>('#settingSoundtouchSave')!.click();

        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 500 });
        await vi.waitFor(() => expect(state.soundtouchStatus).toBe('available'), { timeout: 500 });

        // A's ping now fails — it must NOT overwrite B's newer result.
        rejectA(new Error('offline'));
        await new Promise((r) => setTimeout(r, 0));
        expect(state.soundtouchStatus).toBe('available');
    });

    it('labels the host field with soundtouchNetworkAddress above the config row', () => {
        state.soundtouchAddress = '192.168.1.42';
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();

        const label = document.querySelector<HTMLLabelElement>('.soundtouch-section label[for="settingSoundtouchHost"]');
        expect(label).not.toBeNull();
        expect(label!.textContent).toBe(getLabels(state).soundtouchNetworkAddress);
        const config = document.querySelector<HTMLElement>('.soundtouch-config');
        expect(config).not.toBeNull();
        // the label sits ABOVE the config row (language-select placement), not inside it
        expect(config!.contains(label!)).toBe(false);
        const input = document.querySelector<HTMLInputElement>('#settingSoundtouchHost');
        expect(input).not.toBeNull();
        expect(label!.compareDocumentPosition(input!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // the old inline plain-span label is gone from the config row — only
        // the status span (and the new field label above) remain
        expect(
            Array.from(config!.children).filter((el) => el.tagName === 'SPAN' && !el.classList.contains('soundtouch-status'))
        ).toEqual([]);
    });

    it('drops soundtouchCollapsed and adds soundtouchNetworkAddress in all languages', () => {
        // Hardcoded expected strings per language (NOT derived from any placeholder).
        const NETWORK_ADDRESS: Record<string, string> = {
            en: 'SoundTouch network address',
            de: 'SoundTouch-Netzwerkadresse',
            ru: 'Сетевой адрес SoundTouch',
            ukr: 'Мережева адреса SoundTouch',
        };
        for (const lang of ['en', 'de', 'ru', 'ukr'] as const) {
            const t = getLabels({ language: lang });
            expect(t.soundtouchCollapsed).toBeUndefined();
            expect(t.soundtouchNetworkAddress).toBe(NETWORK_ADDRESS[lang]);
        }
    });

    it('a language switch re-labels the host field in place without rebuilding the popup', () => {
        state.soundtouchAddress = '192.168.1.42';
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const overlay = document.querySelector('.modal-overlay');
        expect(overlay).not.toBeNull();
        const label = document.querySelector<HTMLLabelElement>('.soundtouch-section label[for="settingSoundtouchHost"]');
        expect(label).not.toBeNull();
        expect(label!.textContent).toBe(getLabels(state).soundtouchNetworkAddress);

        const select = document.querySelector<HTMLSelectElement>('#settingLanguage');
        expect(select).not.toBeNull();
        select!.value = 'de';
        select!.dispatchEvent(new Event('change', { bubbles: true }));

        const de = getLabels({ language: 'de' });
        expect(
            document.querySelector<HTMLLabelElement>('.soundtouch-section label[for="settingSoundtouchHost"]')!.textContent
        ).toBe(de.soundtouchNetworkAddress);
        expect(document.querySelector<HTMLInputElement>('#settingSoundtouchHost')!.value).toBe('192.168.1.42');
        expect(document.querySelector('.modal-overlay')).toBe(overlay);
    });
});

describe('popup device info auto-scroll (wave 7.3)', () => {
    // the file's shared beforeEach does not reset soundtouchDevice (AGENTS.md
    // convention) — every test starts from a known-good null device so widget
    // presence is pinned per test, never leaked from an earlier one
    let scrollIntoView: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        state.soundtouchDevice = null;
        // jsdom 25 does not implement Element.prototype.scrollIntoView — not
        // even under pretendToBeVisual — so the auto-scroll can only be pinned
        // through a stub assigned onto the prototype (vi.spyOn would throw on
        // the missing method); the afterEach deletes it again
        scrollIntoView = vi.fn();
        (Element.prototype as unknown as { scrollIntoView?: typeof scrollIntoView }).scrollIntoView = scrollIntoView;
    });

    afterEach(() => {
        delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
    });

    it("opening the popup's ℹ auto-scrolls the expanded rows into view", async () => {
        state.soundtouchDevice = { id: '689E19B8BB8A', name: 'Bose SoundTouch B9B8BC', type: 'SoundTouch 10' };
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();

        const summary = document.querySelector<HTMLElement>('.modal-overlay .soundtouch-info summary');
        expect(summary).not.toBeNull();
        summary!.click();

        // real-timer frame: the popup-context click schedules an rAF; once it
        // fires after the native toggle, the expanded body scrolls into view
        await new Promise((r) => requestAnimationFrame(r));

        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        expect(scrollIntoView.mock.calls[0][0]).toEqual({ block: 'nearest' });
        expect((scrollIntoView.mock.instances[0] as HTMLElement).classList.contains('soundtouch-info-body')).toBe(true);
    });

    it('closing the ℹ does not scroll', async () => {
        state.soundtouchDevice = { id: '689E19B8BB8A', name: 'Bose SoundTouch B9B8BC', type: 'SoundTouch 10' };
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();

        const summary = document.querySelector<HTMLElement>('.modal-overlay .soundtouch-info summary');
        expect(summary).not.toBeNull();
        summary!.click();
        await new Promise((r) => requestAnimationFrame(r));
        expect(scrollIntoView).toHaveBeenCalledTimes(1);

        // the close click schedules its own frame too, but with the details
        // already closed it must NOT scroll again
        summary!.click();
        await new Promise((r) => requestAnimationFrame(r));
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it('the remote header ℹ never auto-scrolls', async () => {
        state.soundtouchDevice = { id: '689E19B8BB8A', name: 'Bose SoundTouch B9B8BC', type: 'SoundTouch 10' };
        render();
        setupEvents();

        const summary = document.querySelector<HTMLElement>('.remote-head .soundtouch-info summary');
        expect(summary).not.toBeNull();
        summary!.click();
        await new Promise((r) => requestAnimationFrame(r));

        expect(scrollIntoView).not.toHaveBeenCalled();
    });
});
