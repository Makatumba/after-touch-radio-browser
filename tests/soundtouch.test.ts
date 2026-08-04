import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, state } from '../src/app';
import { pingSoundtouch, sendToSoundtouch } from '../src/actions';
import { getLabels, translations } from '../src/i18n';
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
// stays type-clean at every commit in the sequence. The FR-3 remote-control
// exports land with the live-remote implementation wave and are typed here
// ahead of time the same way.
async function loadActions() {
    return (await import('../src/actions')) as unknown as {
        soundtouchBaseUrl: (host: string) => string;
        soundtouchWsUrl: (host: string) => string;
        sendKeyPress: (key: string) => Promise<void>;
        sendVolume: (value: number) => Promise<void>;
        sendMute: (muted: boolean) => Promise<void>;
        scheduleVolumeSend: (value: number) => void;
        REMOTE_KEYS: Readonly<{ play: string; pause: string; next: string; prev: string }>;
    };
}

// renderDeviceInfo lands in src/components/soundtouch.ts with the FR-3 widget
// wave; until it is exported, reach it through this typed view so the file
// stays type-clean at every commit in the sequence.
async function loadSoundtouchComponents() {
    return (await import('../src/components/soundtouch')) as unknown as {
        renderDeviceInfo: (state: unknown, t: Record<string, string>) => string;
    };
}

// state.soundtouchDevice and the live-remote fields land with the FR-3
// implementation wave; until src/state.ts gains them, access them through this
// typed view so the file stays type-clean at every commit in the sequence.
// The FR-3 verbose extension retypes soundtouchDevice to the full DeviceInfo.
interface DeviceInfo {
    id: string;
    name?: string;
    type?: string;
    moduleType?: string;
    variant?: string;
    variantMode?: string;
    countryCode?: string;
    regionCode?: string;
    networkType?: string;
    macAddress?: string;
    ipAddress?: string;
    componentCategory?: string;
    serialNumber?: string;
    softwareVersion?: string;
    margeUrl?: string;
    margeAccountUuid?: string;
}

const wsState = state as unknown as {
    wsStatus: string;
    deviceNowPlaying: string;
    deviceArtist: string;
    deviceAlbum: string;
    deviceSource: string;
    devicePlayStatus: string;
    deviceVolume: number;
    deviceMute: boolean;
    soundtouchDevice: DeviceInfo | null;
};

// i18n gains the device-info keys with the FR-3 implementation wave; until
// then the dictionary is accessed through this typed view.
const tView = translations as unknown as Record<string, Record<string, string>>;

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
    wsState.wsStatus = 'idle';
    wsState.deviceNowPlaying = '';
    wsState.deviceArtist = '';
    wsState.deviceAlbum = '';
    wsState.deviceSource = '';
    wsState.devicePlayStatus = '';
    wsState.deviceVolume = 0;
    wsState.deviceMute = false;
    wsState.soundtouchDevice = null;
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

describe('soundtouchWsUrl — WebSocket endpoint', () => {
    it.each<[string, string]>([
        ['192.168.1.42', 'ws://192.168.1.42:8080/'],
        ['192.168.1.42:1234', 'ws://192.168.1.42:1234/'],
        ['http://h:7000/', 'ws://h:7000/'],
        ['', ''],
        ['<script>alert(1)</script>', ''],
    ])('soundtouchWsUrl(%j) === %j', async (host, expected) => {
        const { soundtouchWsUrl } = await loadActions();
        expect(soundtouchWsUrl(host)).toBe(expected);
    });
});

describe('sendKeyPress — press+release key pair', () => {
    it('sends exactly two POSTs, press then release, with sender="Gabbo"', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        const { sendKeyPress, REMOTE_KEYS } = await loadActions();
        await sendKeyPress(REMOTE_KEYS.play);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        const press = fetchMock.mock.calls[0] as [string, RequestInit];
        const release = fetchMock.mock.calls[1] as [string, RequestInit];
        expect(press[0]).toBe('http://192.168.1.42:8090/key');
        expect(release[0]).toBe('http://192.168.1.42:8090/key');
        for (const [url, init] of [press, release]) {
            expect(init.method).toBe('POST');
            expect(init.mode).toBe('no-cors');
            expect(new Headers(init.headers as HeadersInit).get('Content-Type')).toBe('text/plain;charset=UTF-8');
        }
        expect(String(press[1].body)).toBe('<key state="press" sender="Gabbo">PLAY</key>');
        expect(String(release[1].body)).toBe('<key state="release" sender="Gabbo">PLAY</key>');
    });

    it('exposes the four remote keys as a const map', async () => {
        const { REMOTE_KEYS } = await loadActions();
        expect(REMOTE_KEYS).toEqual({ play: 'PLAY', pause: 'PAUSE', next: 'NEXT_TRACK', prev: 'PREV_TRACK' });
    });

    it('never writes live device state (no echo loop)', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        wsState.devicePlayStatus = 'PLAY_STATE';
        wsState.deviceVolume = 50;

        const { sendKeyPress } = await loadActions();
        await sendKeyPress('PAUSE');

        expect(wsState.devicePlayStatus).toBe('PLAY_STATE');
        expect(wsState.deviceVolume).toBe(50);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe('sendVolume / sendMute — volume commands', () => {
    it('sendVolume posts <volume>N</volume> clamped to 0–100', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        const { sendVolume } = await loadActions();
        await sendVolume(50);
        await sendVolume(-5);
        await sendVolume(150);

        expect(fetchMock).toHaveBeenCalledTimes(3);
        const bodies = fetchMock.mock.calls.map((c) => String((c[1] as RequestInit).body));
        expect(bodies).toEqual(['<volume>50</volume>', '<volume>0</volume>', '<volume>100</volume>']);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://192.168.1.42:8090/volume');
        expect(init.method).toBe('POST');
        expect(init.mode).toBe('no-cors');
        expect(new Headers(init.headers as HeadersInit).get('Content-Type')).toBe('text/plain;charset=UTF-8');
    });

    it('sendMute posts a muteenabled body for true and false', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        const { sendMute } = await loadActions();
        await sendMute(true);
        await sendMute(false);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        const bodies = fetchMock.mock.calls.map((c) => String((c[1] as RequestInit).body));
        expect(bodies).toEqual(['<volume><muteenabled>true</muteenabled></volume>', '<volume><muteenabled>false</muteenabled></volume>']);
    });
});

describe('scheduleVolumeSend — debounced volume', () => {
    it('debounces rapid changes into a single POST with the last value', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        const { scheduleVolumeSend } = await loadActions();
        scheduleVolumeSend(20);
        scheduleVolumeSend(30);
        scheduleVolumeSend(40);
        expect(fetchMock).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(400);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://192.168.1.42:8090/volume');
        expect(String(init.body)).toBe('<volume>40</volume>');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('drops a pending volume POST when the host changes before the delay elapses', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        const { scheduleVolumeSend } = await loadActions();
        scheduleVolumeSend(50);
        state.soundtouchAddress = '192.168.1.99';
        await vi.advanceTimersByTimeAsync(400);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('never writes the live device volume (no echo loop)', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        wsState.deviceVolume = 30;

        const { scheduleVolumeSend } = await loadActions();
        scheduleVolumeSend(80);
        await vi.advanceTimersByTimeAsync(400);
        expect(wsState.deviceVolume).toBe(30);
    });
});

describe('device info widget (FR-3, WebSocket-fed)', () => {
    it('renders nothing before any device has been observed', async () => {
        const { renderDeviceInfo } = await loadSoundtouchComponents();
        const html = renderDeviceInfo(state, getLabels(state));

        expect(html).toBe('');
        expect(html).not.toContain('soundtouch-info');
    });

    it('shows exactly the device ID row when only the id is known', async () => {
        const { renderDeviceInfo } = await loadSoundtouchComponents();
        wsState.soundtouchDevice = { id: '689E19B8BB8A' };
        const t = getLabels(state);
        const html = renderDeviceInfo(state, t);

        expect(html).toContain('soundtouch-info');
        expect(html).toContain(t.deviceId);
        expect(html).toContain('689E19B8BB8A');
        expect(html).not.toContain(t.deviceName);
        expect(html).not.toContain(t.deviceType);
        expect(html.match(/soundtouch-info-row/g)).toHaveLength(1);
    });

    it('shows id, name, and type rows when all are present', async () => {
        const { renderDeviceInfo } = await loadSoundtouchComponents();
        wsState.soundtouchDevice = { id: '689E19B8BB8A', name: 'Bose SoundTouch B9B8BC', type: 'SoundTouch 10' };
        const t = getLabels(state);
        const html = renderDeviceInfo(state, t);

        expect(html).toContain(t.deviceId);
        expect(html).toContain('689E19B8BB8A');
        expect(html).toContain(t.deviceName);
        expect(html).toContain('Bose SoundTouch B9B8BC');
        expect(html).toContain(t.deviceType);
        expect(html).toContain('SoundTouch 10');
        expect(html.match(/soundtouch-info-row/g)).toHaveLength(3);
    });

    it('keeps the widget visible while reconnecting or unreachable', () => {
        wsState.soundtouchDevice = { id: '689E19B8BB8A' };

        wsState.wsStatus = 'reconnecting';
        render();
        expect(document.querySelector('.soundtouch-info')).not.toBeNull();

        state.soundtouchStatus = 'unreachable';
        render();
        expect(document.querySelector('.soundtouch-info')).not.toBeNull();
    });

    it('adds non-empty device-info labels in all four languages', () => {
        const keys = ['deviceName', 'deviceType', 'deviceId', 'deviceModuleType', 'deviceVariant', 'deviceSerial', 'deviceIp', 'deviceFirmware'];
        for (const lang of ['en', 'de', 'ru', 'ukr'] as const) {
            for (const key of keys) {
                expect(tView[lang][key]?.trim()).toBeTruthy();
            }
        }
    });
});

describe('device info widget — curated verbose rows (FR-3 extension)', () => {
    it('renders the eight curated rows when the full DeviceInfo is known', async () => {
        const { renderDeviceInfo } = await loadSoundtouchComponents();
        wsState.soundtouchDevice = {
            id: '689E19B8BB8A',
            name: 'Bose SoundTouch B9B8BC',
            type: 'SoundTouch 10',
            moduleType: 'soundtouch',
            variant: 'Variant XYZ',
            variantMode: 'normal',
            countryCode: 'DE',
            regionCode: 'EU',
            networkType: 'WIRED',
            macAddress: '68:9E:19:B8:BB:8A',
            ipAddress: '192.168.1.42',
            componentCategory: 'SoundTouch',
            serialNumber: 'SN-1234',
            softwareVersion: '3.8.8.2',
            margeUrl: 'https://marge.example.com',
            margeAccountUuid: 'uuid-1',
        };
        const t = getLabels(state);
        const html = renderDeviceInfo(state, t);

        // the curated set: id, name, type, moduleType, variant, serial, ip, firmware
        expect(html.match(/soundtouch-info-row/g)).toHaveLength(8);
        expect(html).toContain(t.deviceId);
        expect(html).toContain('689E19B8BB8A');
        expect(html).toContain(t.deviceName);
        expect(html).toContain('Bose SoundTouch B9B8BC');
        expect(html).toContain(t.deviceType);
        expect(html).toContain('SoundTouch 10');
        expect(html).toContain(t.deviceModuleType);
        expect(html).toContain('soundtouch');
        expect(html).toContain(t.deviceVariant);
        expect(html).toContain('Variant XYZ');
        expect(html).toContain(t.deviceSerial);
        expect(html).toContain('SN-1234');
        expect(html).toContain(t.deviceIp);
        expect(html).toContain('192.168.1.42');
        expect(html).toContain(t.deviceFirmware);
        expect(html).toContain('3.8.8.2');
        // parsed-but-not-curated fields (variantMode, country, network, marge)
        // render no extra rows — exactly eight remain
        expect(html.match(/soundtouch-info-row/g)).toHaveLength(8);
    });

    it('renders exactly the present curated rows for a partial DeviceInfo', async () => {
        const { renderDeviceInfo } = await loadSoundtouchComponents();
        wsState.soundtouchDevice = { id: '689E19B8BB8A', moduleType: 'soundtouch', ipAddress: '192.168.1.42' };
        const t = getLabels(state);
        const html = renderDeviceInfo(state, t);

        expect(html.match(/soundtouch-info-row/g)).toHaveLength(3);
        expect(html).toContain(t.deviceId);
        expect(html).toContain('689E19B8BB8A');
        expect(html).toContain(t.deviceModuleType);
        expect(html).toContain('soundtouch');
        expect(html).toContain(t.deviceIp);
        expect(html).toContain('192.168.1.42');
        for (const label of [t.deviceName, t.deviceType, t.deviceVariant, t.deviceSerial, t.deviceFirmware]) {
            expect(html).not.toContain(label);
        }
    });
});
