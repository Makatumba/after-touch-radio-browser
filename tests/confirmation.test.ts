import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, state } from '../src/app';
import { setupEvents } from '../src/events';
import { connectSoundtouchWs } from '../src/soundtouch-ws';
import { getLabels, translations } from '../src/i18n';
import { defaultSettings } from '../src/settings';
import { getAudioElement } from '../src/player';
import type { DeviceNowPlayingVerbose, Station } from '../src/state';

const LS_LANGUAGE = 'radio-browser-language';
const LS_SOUNDTOUCH = 'radio-browser-soundtouch-host';
const LS_FAVORITES = 'radio-browser-favorites';
const LS_SETTINGS = 'radio-browser-settings';

const STATION_A: Station = {
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

const STATION_B: Station = {
    stationuuid: 'xyz-789-uvw',
    name: 'Second FM',
    url: 'http://stream.example.com/two.mp3',
    url_resolved: 'http://stream.example.com/two-live.mp3',
    country: 'Germany',
    language: 'english',
    codec: 'MP3',
    bitrate: 96,
    lastcheckok: true,
};

// The FR-4 confirmation module lands in src/confirmation.ts with the
// implementation wave; the fields it reads are accessed through this typed
// view so the file stays type-clean at every commit in the sequence.
const wsState = state as unknown as {
    deviceMessage: string;
    soundtouchStatus: string;
    wsStatus: string;
    deviceSource: string;
    devicePlayStatus: string;
    deviceNowPlayingDetail: DeviceNowPlayingVerbose | null;
    soundtouchDevice: { id: string; name?: string } | null;
};

// i18n gains the confirmation keys with the FR-4 implementation wave; until
// then the dictionary is accessed through this typed view.
const tView = translations as unknown as Record<string, Record<string, string>>;

// jsdom has no WebSocket. The module must resolve `WebSocket` at construction
// time (plain global lookup) for this stub to be seen — capturing it at module
// load would make every test here fail.
class FakeWebSocket {
    static instances: FakeWebSocket[] = [];
    url: string;
    protocols: string | string[];
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;
    // records the REST-proxy envelopes the client sends over the socket
    // (the snapshot requests land here on open)
    sent: string[] = [];

    constructor(url: string, protocols?: string | string[]) {
        this.url = url;
        this.protocols = protocols ?? [];
        FakeWebSocket.instances.push(this);
    }

    close(): void {
        this.closed = true;
    }

    send(data: string): void {
        this.sent.push(String(data));
    }

    open(): void {
        this.onopen?.();
    }

    message(xml: string): void {
        this.onmessage?.({ data: xml });
    }

    closeFromServer(): void {
        this.onclose?.();
    }

    fail(): void {
        this.onerror?.();
        this.onclose?.();
    }
}

// Lets the play-tap's async send chain (and the reachability probes) settle
// under fake timers: their promises resolve as microtasks.
const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
};

const LOCATION = (uuid: string) => `/stations/byuuid/${uuid}`;

// The now-playing payload shape the app's own /select POST produces an echo
// for — the same body goes into pushed <updates> events and RESPONSE bodies.
const nowPlayingXml = (opts: { location: string; playStatus: string; source: string }) =>
    `<updates deviceID="689E19B8BB8A"><nowPlayingUpdated deviceID="689E19B8BB8A"><nowPlaying source="${opts.source}">
    <track>Track title</track>
    <artist>Artist name</artist>
    <album>Album name</album>
    <ContentItem source="${opts.source}" type="STATION" location="${opts.location}">
        <itemName>Station name</itemName>
    </ContentItem>
    <playStatus>${opts.playStatus}</playStatus>
</nowPlaying></nowPlayingUpdated></updates>`;

const nowPlayingResponseXml = (opts: { location: string; playStatus: string; source: string }) =>
    `<msg><header deviceID="689E19B8BB8A" url="now_playing" method="GET" msgType="RESPONSE"><request requestID="1"/></header><body><nowPlaying source="${opts.source}">
    <track>Track title</track>
    <artist>Artist name</artist>
    <album>Album name</album>
    <ContentItem source="${opts.source}" type="STATION" location="${opts.location}">
        <itemName>Station name</itemName>
    </ContentItem>
    <playStatus>${opts.playStatus}</playStatus>
</nowPlaying></body></msg>`;

// A full verbose-detail object with empty defaults, for tests that seed the
// device's live now-playing state directly.
const emptyDetail = (): DeviceNowPlayingVerbose => ({
    stationName: '',
    art: '',
    artImageStatus: '',
    contentItem: null,
    sourceAccount: '',
    timeTotal: null,
    timePosition: '',
    skipEnabled: false,
    skipPreviousEnabled: false,
    favoriteEnabled: false,
    seekSupported: false,
    shuffleSetting: '',
    repeatSetting: '',
    streamType: '',
    trackId: '',
    position: '',
    description: '',
    stationLocation: '',
});

// The pending send message: the interpolated sendingToSpeaker label. The
// device label prefers the known device name and falls back to the address.
const pendingMessage = (station: Station): string =>
    getLabels(state)
        .sendingToSpeaker
        .replace('{station}', station.name)
        .replace('{device}', wsState.soundtouchDevice?.name ?? state.soundtouchAddress);

// Connects + opens the device socket, renders the station list, and taps the
// station's primary action — the full user path that arms a pending send.
function arm(station: Station): void {
    connectSoundtouchWs('192.168.1.42');
    FakeWebSocket.instances[0].open();
    state.stations = [station];
    render();
    setupEvents();
    document.querySelector<HTMLButtonElement>(`[data-play="${station.stationuuid}"]`)!.click();
}

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    state.language = 'en';
    // REQUIRED: without an address App() renders the setup view; the shared
    // state must be reset to a known-good device before every test.
    state.soundtouchAddress = '192.168.1.42';
    state.soundtouchStatus = 'available';
    wsState.deviceMessage = '';
    state.skippedSetup = false;
    state.settings = { ...defaultSettings };
    state.stations = [];
    state.favorites = [];
    wsState.wsStatus = 'idle';
    wsState.deviceSource = '';
    wsState.devicePlayStatus = '';
    wsState.deviceNowPlayingDetail = null;
    // a known device name makes the pending-message interpolation deterministic
    wsState.soundtouchDevice = { id: '689E19B8BB8A', name: 'Bose SoundTouch B9B8BC' };
    // jsdom's StorageImpl schedules a 0ms setTimeout for every mutating
    // storage call (setItem/removeItem/clear) to fire a cross-window storage
    // event; under vi.useFakeTimers() those become phantom timers that break
    // the exact vi.getTimerCount() assertions below. No test here reads
    // stored values back, so stub the writes out (restored by afterEach).
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'clear').mockImplementation(() => {});
    for (const key of [LS_LANGUAGE, LS_SOUNDTOUCH, LS_FAVORITES, LS_SETTINGS]) {
        localStorage.removeItem(key);
    }
    getAudioElement().removeAttribute('src');
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('live now-playing confirmation of play actions (FR-4)', () => {
    it('shows a pending message when a station is sent to the speaker', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        arm(STATION_A);
        await flush();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toMatch(/:8090\/select$/);
        expect(String(init.body)).toContain(LOCATION(STATION_A.stationuuid));
        expect(wsState.deviceMessage).toBe(pendingMessage(STATION_A));
        expect(vi.getTimerCount()).toBe(1); // exactly one 15s confirmation timer
    });

    it('confirms silently when the pushed now-playing payload matches', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        arm(STATION_A);
        await flush();
        expect(wsState.deviceMessage).toBe(pendingMessage(STATION_A));
        expect(vi.getTimerCount()).toBe(1);

        FakeWebSocket.instances[0].message(
            nowPlayingXml({ location: LOCATION(STATION_A.stationuuid), playStatus: 'PLAY_STATE', source: 'RADIO_BROWSER' })
        );

        expect(wsState.deviceMessage).toBe('');
        expect(vi.getTimerCount()).toBe(0);

        // an unrelated payload (different location, non-RB source) stays ignored
        expect(() => {
            FakeWebSocket.instances[0].message(
                nowPlayingXml({ location: '/v1/play/999', playStatus: 'PLAY_STATE', source: 'AUX' })
            );
        }).not.toThrow();
        expect(wsState.deviceMessage).toBe('');
    });

    it('confirms silently from a snapshot RESPONSE', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        arm(STATION_A);
        await flush();
        expect(wsState.deviceMessage).toBe(pendingMessage(STATION_A));
        expect(vi.getTimerCount()).toBe(1);

        FakeWebSocket.instances[0].message(
            nowPlayingResponseXml({ location: LOCATION(STATION_A.stationuuid), playStatus: 'PLAY_STATE', source: 'RADIO_BROWSER' })
        );

        expect(wsState.deviceMessage).toBe('');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps waiting while the matching station buffers', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        arm(STATION_A);
        await flush();
        expect(vi.getTimerCount()).toBe(1);

        FakeWebSocket.instances[0].message(
            nowPlayingXml({ location: LOCATION(STATION_A.stationuuid), playStatus: 'BUFFERING_STATE', source: 'RADIO_BROWSER' })
        );

        expect(wsState.deviceMessage).toBe(pendingMessage(STATION_A));
        expect(vi.getTimerCount()).toBe(1);
    });

    it('shows the stream-failure hint when the matching station stops', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        arm(STATION_A);
        await flush();
        expect(vi.getTimerCount()).toBe(1);

        FakeWebSocket.instances[0].message(
            nowPlayingXml({ location: LOCATION(STATION_A.stationuuid), playStatus: 'STOP_STATE', source: 'RADIO_BROWSER' })
        );

        expect(wsState.deviceMessage).toBe(getLabels(state).streamFailedHint);
        expect(vi.getTimerCount()).toBe(0);

        // the hint is persistent — time passing changes nothing
        await vi.advanceTimersByTimeAsync(10_000);
        expect(wsState.deviceMessage).toBe(getLabels(state).streamFailedHint);
    });

    it('prefers the INVALID_SOURCE hint over a matching stop', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        arm(STATION_A);
        await flush();
        expect(vi.getTimerCount()).toBe(1);

        FakeWebSocket.instances[0].message(
            nowPlayingXml({ location: LOCATION(STATION_A.stationuuid), playStatus: 'STOP_STATE', source: 'INVALID_SOURCE' })
        );

        expect(wsState.deviceMessage).toBe(getLabels(state).invalidSourceHint);
        expect(wsState.deviceMessage).not.toBe(getLabels(state).streamFailedHint);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('ignores unrelated payloads while a send is pending', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        arm(STATION_A);
        await flush();
        expect(vi.getTimerCount()).toBe(1);

        FakeWebSocket.instances[0].message(
            nowPlayingXml({ location: '/v1/play/999', playStatus: 'PLAY_STATE', source: 'AUX' })
        );

        expect(wsState.deviceMessage).toBe(pendingMessage(STATION_A));
        expect(vi.getTimerCount()).toBe(1);
    });

    it('shows the timeout hint when the device never confirms', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        arm(STATION_A);
        await flush();
        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(14_000);
        expect(wsState.deviceMessage).toBe(pendingMessage(STATION_A)); // still pending just before the deadline

        await vi.advanceTimersByTimeAsync(1_000);
        expect(wsState.deviceMessage).toBe(getLabels(state).confirmTimeoutHint);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels the pending confirmation on a remote command', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        arm(STATION_A);
        await flush();
        expect(vi.getTimerCount()).toBe(1); // a pending send exists to cancel

        document.querySelector<HTMLButtonElement>('#remotePlayPause')!.click();
        await flush();

        expect(wsState.deviceMessage).toBe('');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels the pending confirmation on address change', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        arm(STATION_A);
        await flush();
        expect(vi.getTimerCount()).toBe(1); // a pending send exists to cancel

        const input = document.querySelector<HTMLInputElement>('#soundtouch')!;
        input.value = '192.168.1.43';
        document.querySelector<HTMLButtonElement>('#saveSoundtouch')!.click();
        await flush();

        expect(wsState.deviceMessage).toBe('');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels the pending confirmation when the device becomes unreachable', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockImplementation((url: string) =>
            url.endsWith('/select') ? Promise.resolve({} as Response) : Promise.reject(new Error('offline'))
        );
        vi.stubGlobal('fetch', fetchMock);

        arm(STATION_A);
        await flush();
        expect(vi.getTimerCount()).toBe(1); // a pending send exists to cancel

        FakeWebSocket.instances[0].closeFromServer();
        await flush();
        await vi.advanceTimersByTimeAsync(1000); // probe #2 fails
        await flush();
        await vi.advanceTimersByTimeAsync(2000); // probe #3 fails
        await flush();

        expect(wsState.soundtouchStatus).toBe('unreachable');
        expect(wsState.deviceMessage).toBe('');
        render();
        expect(document.querySelector('.offline-banner')).not.toBeNull();

        // the confirmation timeout is gone — the hint never appears, even late
        await vi.advanceTimersByTimeAsync(15_000);
        expect(wsState.deviceMessage).toBe('');
        expect(wsState.deviceMessage).not.toBe(getLabels(state).confirmTimeoutHint);
    });

    it('last-write-wins when a second station is sent', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        connectSoundtouchWs('192.168.1.42');
        FakeWebSocket.instances[0].open();
        state.stations = [STATION_A, STATION_B];
        render();
        setupEvents();

        document.querySelector<HTMLButtonElement>(`[data-play="${STATION_A.stationuuid}"]`)!.click();
        await flush();
        expect(wsState.deviceMessage).toBe(pendingMessage(STATION_A));
        expect(vi.getTimerCount()).toBe(1);

        document.querySelector<HTMLButtonElement>(`[data-play="${STATION_B.stationuuid}"]`)!.click();
        await flush();
        expect(wsState.deviceMessage).toBe(pendingMessage(STATION_B));
        expect(vi.getTimerCount()).toBe(1);

        // a payload matching the FIRST station is a stale echo — the B send stands
        FakeWebSocket.instances[0].message(
            nowPlayingXml({ location: LOCATION(STATION_A.stationuuid), playStatus: 'PLAY_STATE', source: 'RADIO_BROWSER' })
        );
        expect(wsState.deviceMessage).toBe(pendingMessage(STATION_B));
        expect(vi.getTimerCount()).toBe(1);
    });

    it('does not re-send or show a message when the station is already playing', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        wsState.wsStatus = 'connected';
        wsState.deviceSource = 'RADIO_BROWSER';
        wsState.devicePlayStatus = 'PLAY_STATE';
        wsState.deviceNowPlayingDetail = {
            ...emptyDetail(),
            contentItem: {
                source: 'RADIO_BROWSER',
                type: 'STATION',
                location: LOCATION(STATION_A.stationuuid),
                sourceAccount: '',
                itemName: '',
                containerArt: '',
            },
        };

        state.stations = [STATION_A];
        render();
        setupEvents();

        document.querySelector<HTMLButtonElement>(`[data-play="${STATION_A.stationuuid}"]`)!.click();
        await flush();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(wsState.deviceMessage).toBe('');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('confirms via the source fallback when the location is transformed', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        arm(STATION_B);
        await flush();
        expect(vi.getTimerCount()).toBe(1);
        // the device was NOT playing a Radio Browser station at send time (t0 state)

        FakeWebSocket.instances[0].message(
            nowPlayingXml({ location: '/v1/play/xyz', playStatus: 'PLAY_STATE', source: 'RADIO_BROWSER' })
        );

        expect(wsState.deviceMessage).toBe('');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not use the source fallback when radio was already playing', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        // the device is already playing a (different) Radio Browser station
        wsState.deviceSource = 'RADIO_BROWSER';
        wsState.devicePlayStatus = 'PLAY_STATE';
        wsState.deviceNowPlayingDetail = {
            ...emptyDetail(),
            contentItem: {
                source: 'RADIO_BROWSER',
                type: 'STATION',
                location: '/v1/play/xyz',
                sourceAccount: '',
                itemName: '',
                containerArt: '',
            },
        };

        connectSoundtouchWs('192.168.1.42');
        FakeWebSocket.instances[0].open();
        state.stations = [STATION_B];
        render();
        setupEvents();

        document.querySelector<HTMLButtonElement>(`[data-play="${STATION_B.stationuuid}"]`)!.click();
        await flush();
        expect(vi.getTimerCount()).toBe(1);

        FakeWebSocket.instances[0].message(
            nowPlayingXml({ location: '/v1/play/xyz', playStatus: 'PLAY_STATE', source: 'RADIO_BROWSER' })
        );

        expect(wsState.deviceMessage).toBe(pendingMessage(STATION_B));
        expect(vi.getTimerCount()).toBe(1);
    });

    it('never issues device traffic while evaluating', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        arm(STATION_A);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1); // only the select POST
        expect(FakeWebSocket.instances[0].sent).toHaveLength(3); // the on-open snapshot

        FakeWebSocket.instances[0].message(
            nowPlayingXml({ location: LOCATION(STATION_A.stationuuid), playStatus: 'PLAY_STATE', source: 'RADIO_BROWSER' })
        );

        // the evaluation confirmed silently and added nothing to the wire
        expect(wsState.deviceMessage).toBe('');
        expect(vi.getTimerCount()).toBe(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(FakeWebSocket.instances[0].sent).toHaveLength(3);
    });

    it('escapes station names in the pending message', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        const hostile = { ...STATION_A, name: '<img src=x onerror=alert(1)>' };
        arm(hostile);
        await flush();

        const hint = document.querySelector<HTMLElement>('.soundtouch-hint');
        expect(hint).not.toBeNull();
        expect(hint!.innerHTML).toContain('&lt;img');
        expect(hint!.textContent).toContain('<img src=x onerror=alert(1)>');
        expect(hint!.querySelector('img')).toBeNull();
    });

    it('adds the confirmation i18n keys in all four languages and drops playingOnSpeaker', () => {
        const keys = ['sendingToSpeaker', 'invalidSourceHint', 'streamFailedHint', 'confirmTimeoutHint'];
        for (const lang of ['en', 'de', 'ru', 'ukr'] as const) {
            for (const key of keys) {
                expect(tView[lang][key]?.trim()).toBeTruthy();
            }
            expect(tView[lang].playingOnSpeaker).toBeUndefined();
        }
        expect(tView.en.nowPlayingConfirmed).toBeUndefined();
    });
});
