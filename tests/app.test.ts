import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error the repo has no @types/node; node:fs is available at runtime via vitest
import fs from 'node:fs';
import { App, render, state } from '../src/app';
import { getLabels, translations } from '../src/i18n';
import { defaultSettings, loadSettings } from '../src/settings';
import { setupEvents } from '../src/events';
import { getAudioElement } from '../src/player';
import type { Station } from '../src/state';

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

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
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
        const html = App();
        expect(html).toContain('data-lang="de"');
        expect(html).toContain('Search stations');
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

        it('renders the footer with the settings modal open', () => {
            state.showSettings = true;
            render();
            expect(document.querySelector('.modal-overlay')).not.toBeNull();
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
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
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
        await vi.waitFor(
            () => expect(document.body.textContent).toContain(`✓ ${getLabels(state).reachable}`),
            { timeout: 500 }
        );
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
        expect(document.querySelector('.setup-view')).toBeNull();
        await vi.waitFor(() => expect(document.querySelector('.offline-banner')).not.toBeNull(), { timeout: 500 });
        expect(document.querySelector('.offline-banner')!.textContent).toContain(getLabels(state).offlineBanner);
    });

    it('ignores a stale ping result after the address changes', async () => {
        let rejectA!: (reason: Error) => void;
        const pendingA = new Promise<Response>((_, reject) => {
            rejectA = reject;
        });
        const fetchMock = vi
            .fn()
            .mockImplementationOnce(() => pendingA)
            .mockResolvedValue({ ok: true } as Response);
        vi.stubGlobal('fetch', fetchMock);

        state.soundtouchAddress = '';
        state.skippedSetup = false;
        render();
        setupEvents();

        // Save host A — its reachability ping stays pending.
        let input = document.querySelector<HTMLInputElement>('#soundtouch')!;
        input.value = 'http://192.168.1.42/';
        document.querySelector<HTMLButtonElement>('#saveSoundtouch')!.click();

        // Save host B — its ping resolves immediately to available.
        input = document.querySelector<HTMLInputElement>('#soundtouch')!;
        input.value = '192.168.1.99';
        document.querySelector<HTMLButtonElement>('#saveSoundtouch')!.click();

        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 500 });
        await vi.waitFor(() => expect(state.soundtouchStatus).toBe('available'), { timeout: 500 });

        // A's ping now fails — it must NOT overwrite B's newer result.
        rejectA(new Error('offline'));
        await new Promise((r) => setTimeout(r, 0));
        expect(state.soundtouchStatus).toBe('available');
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
        await vi.waitFor(() => expect(state.deviceMessage).toBe(getLabels(state).playingOnSpeaker), { timeout: 500 });
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
        expect(loadSettings()).toEqual({ enablePreview: true });
    });

    it('defaults enablePreview to false when only legacy keys are stored', () => {
        localStorage.setItem(LS_SETTINGS, JSON.stringify({ disablePlayer: true }));
        expect(loadSettings()).toEqual({ enablePreview: false });
    });

    it('rejects a non-boolean enablePreview value', () => {
        localStorage.setItem(LS_SETTINGS, JSON.stringify({ enablePreview: 'yes' }));
        expect(loadSettings()).toEqual({ enablePreview: false });
    });

    it('falls back to defaults on corrupt JSON', () => {
        localStorage.setItem(LS_SETTINGS, '{corrupt');
        expect(loadSettings()).toEqual({ enablePreview: false });
    });

    it('renders exactly one toggle in the settings modal', () => {
        state.showSettings = true;
        render();
        const toggles = document.querySelectorAll('.modal-body input[type="checkbox"]');
        expect(toggles.length).toBe(1);
        const toggle = document.querySelector<HTMLInputElement>('#settingEnablePreview');
        expect(toggle).not.toBeNull();
        expect(toggle!.parentElement!.textContent).toContain(getLabels(state).settingEnablePreview);
        expect(document.querySelector('#settingDisablePlayer')).toBeNull();
        expect(document.querySelector('#settingDisablePlayButton')).toBeNull();
        expect(document.querySelector('#settingSoundtouchDefault')).toBeNull();
    });

    it('reset restores default settings and persists them', () => {
        state.showSettings = true;
        render();
        setupEvents();

        const toggle = document.querySelector<HTMLInputElement>('#settingEnablePreview');
        expect(toggle).not.toBeNull();
        toggle!.checked = true;
        toggle!.dispatchEvent(new Event('change', { bubbles: true }));
        expect(state.settings.enablePreview).toBe(true);

        document.querySelector<HTMLButtonElement>('#resetSettings')!.click();
        expect(state.settings).toEqual({ enablePreview: false });
        expect(JSON.parse(localStorage.getItem(LS_SETTINGS)!)).toEqual({ enablePreview: false });
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

    it('switches the language from the chip', () => {
        render();
        setupEvents();
        document.querySelector<HTMLButtonElement>('[data-lang="de"]')!.click();
        expect(state.language).toBe('de');
        expect(localStorage.getItem(LS_LANGUAGE)).toBe('de');
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
