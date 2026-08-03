import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from '../src/app';
import { pingSoundtouch, sendToSoundtouch } from '../src/actions';
import { defaultSettings } from '../src/settings';
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

// soundtouchBaseUrl lands with the probe reachability feature; until
// src/actions.ts exports it, access it through this typed view so the file
// stays type-clean at every commit in the sequence.
async function loadActions() {
    return (await import('../src/actions')) as unknown as {
        soundtouchBaseUrl: (host: string) => string;
    };
}

// A fetch mock whose promise never settles on its own — it only rejects when
// the caller's AbortSignal fires (exercises the 5s per-attempt timeout).
const hanging = () => (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    state.language = 'en';
    // REQUIRED: without an address App() renders the setup view; the shared
    // state must be reset to a known-good device before every test.
    state.soundtouchAddress = '192.168.1.42';
    state.soundtouchStatus = 'available';
    state.deviceMessage = '';
    state.skippedSetup = false;
    state.settings = { ...defaultSettings };
    state.stations = [];
    state.favorites = [];
    for (const key of [LS_LANGUAGE, LS_SOUNDTOUCH, LS_FAVORITES, LS_SETTINGS]) {
        localStorage.removeItem(key);
    }
    getAudioElement().removeAttribute('src');
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('pingSoundtouch — no-cors probe on port 8090', () => {
    it('reports reachable when the probe resolves (opaque no-cors response)', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        expect(await pingSoundtouch('192.168.1.42')).toBe(true);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://192.168.1.42:8090/info');
        expect(init.method).toBe('GET');
        expect(init.mode).toBe('no-cors');
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('reports unreachable when the probe rejects', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
        vi.stubGlobal('fetch', fetchMock);

        expect(await pingSoundtouch('192.168.1.42')).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('honors an explicit port in the host (no :8090 appended)', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        expect(await pingSoundtouch('192.168.1.42:1234')).toBe(true);

        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toBe('http://192.168.1.42:1234/info');
    });

    it.each<[string, string]>([
        ['192.168.1.42', 'http://192.168.1.42:8090'],
        ['192.168.1.42:1234', 'http://192.168.1.42:1234'],
        ['http://h:7000/', 'http://h:7000'],
        ['', ''],
        ['<script>alert(1)</script>', ''],
    ])('soundtouchBaseUrl(%j) === %j', async (host, expected) => {
        const { soundtouchBaseUrl } = await loadActions();
        expect(soundtouchBaseUrl(host)).toBe(expected);
    });

    it('rejects an invalid host without any network call', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        expect(await pingSoundtouch('<script>alert(1)</script>')).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('aborts a hung probe after 5s and reports unreachable', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockImplementation(hanging());
        vi.stubGlobal('fetch', fetchMock);

        const p = pingSoundtouch('192.168.1.42');
        await vi.advanceTimersByTimeAsync(5000);
        expect(await p).toBe(false);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        // The watchdog is cleared after the abort settles — nothing dangles.
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('sendToSoundtouch — explicit port', () => {
    it('honors an explicit port in the host (no :8090 double-append)', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        state.soundtouchAddress = '192.168.1.42:1234';
        state.soundtouchStatus = 'available';
        await sendToSoundtouch(STATION, state);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toBe('http://192.168.1.42:1234/select');
        expect(state.soundtouchStatus).toBe('available');
    });
});
