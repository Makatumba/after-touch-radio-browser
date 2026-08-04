import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, state } from '../src/app';
import { setupEvents } from '../src/events';
// FR-3 modules — both land with the live-remote implementation wave; the
// module-not-found failures here are the intended red at this commit.
import { closeSoundtouchWs, connectSoundtouchWs } from '../src/soundtouch-ws';
import { renderRemotePanel } from '../src/components/remote';
import { getLabels, translations } from '../src/i18n';
import { defaultSettings } from '../src/settings';
import { getAudioElement } from '../src/player';

const LS_LANGUAGE = 'radio-browser-language';
const LS_SOUNDTOUCH = 'radio-browser-soundtouch-host';
const LS_FAVORITES = 'radio-browser-favorites';
const LS_SETTINGS = 'radio-browser-settings';

// state.ts gains the live-remote fields with the FR-3 implementation wave;
// until then they are accessed through this typed view so the file stays
// type-clean at every commit in the sequence (only the two new modules are
// red at this commit).
const wsState = state as unknown as {
    wsStatus: string;
    deviceNowPlaying: string;
    deviceArtist: string;
    deviceAlbum: string;
    deviceSource: string;
    devicePlayStatus: string;
    deviceVolume: number;
    deviceMute: boolean;
    soundtouchDevice: { id: string; name?: string; type?: string } | null;
};

// i18n gains the remote-panel keys with the FR-3 implementation wave; until
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

    constructor(url: string, protocols?: string | string[]) {
        this.url = url;
        this.protocols = protocols ?? [];
        FakeWebSocket.instances.push(this);
    }

    close(): void {
        this.closed = true;
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

// Lets pingSoundtouch's probe settle under fake timers: its 5s watchdog timer
// clears on settle, leaving only the reconnection backoff timer pending.
const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
};

const NOW_PLAYING_XML = (track: string, playStatus: string, source = 'RADIO_BROWSER') =>
    `<updates deviceID="689E19B8BB8A"><nowPlayingUpdated><nowPlaying source="${source}"><track>${track}</track><artist>Artist name</artist><album>Album name</album><playStatus>${playStatus}</playStatus></nowPlaying></nowPlayingUpdated></updates>`;

const VOLUME_XML = (volume: number, mute: boolean) =>
    `<updates deviceID="689E19B8BB8A"><volumeUpdated><volume><targetvolume>${volume}</targetvolume><actualvolume>${volume}</actualvolume><muteenabled>${mute}</muteenabled></volume></volumeUpdated></updates>`;

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
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('connectSoundtouchWs — WebSocket connection lifecycle', () => {
    it('connects to ws://<host>:8080/ with the gabbo protocol and marks connecting', () => {
        connectSoundtouchWs('192.168.1.42');

        expect(FakeWebSocket.instances).toHaveLength(1);
        const ws = FakeWebSocket.instances[0];
        expect(ws.url).toBe('ws://192.168.1.42:8080/');
        expect(ws.protocols).toEqual(['gabbo']);
        expect(wsState.wsStatus).toBe('connecting');
    });

    it('honors an explicit port in the host (no :8080 appended)', () => {
        connectSoundtouchWs('192.168.1.42:1234');

        expect(FakeWebSocket.instances[0].url).toBe('ws://192.168.1.42:1234/');
    });

    it.each<string>(['', '<script>alert(1)</script>', 'http://'])('does not connect for an invalid host %j', (host) => {
        connectSoundtouchWs(host);
        expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it('keeps exactly one socket: connecting a new host closes the old one', () => {
        connectSoundtouchWs('192.168.1.42');
        connectSoundtouchWs('192.168.1.43');

        expect(FakeWebSocket.instances).toHaveLength(2);
        expect(FakeWebSocket.instances[0].closed).toBe(true);
        expect(FakeWebSocket.instances[1].closed).toBe(false);
    });

    it('marks the connection connected on open', () => {
        connectSoundtouchWs('192.168.1.42');
        FakeWebSocket.instances[0].open();

        expect(wsState.wsStatus).toBe('connected');
    });

    it('closeSoundtouchWs closes the socket, cancels retries, and resets the status', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.closeFromServer();
        await flush();
        expect(vi.getTimerCount()).toBe(1); // the reconnection backoff is pending

        closeSoundtouchWs();

        expect(ws.closed).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        expect(wsState.wsStatus).toBe('idle');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(FakeWebSocket.instances).toHaveLength(1); // nothing reconnects
    });

    it('treats an error as a drop (onerror then onclose) with a single probe', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        connectSoundtouchWs('192.168.1.42');
        FakeWebSocket.instances[0].open();
        FakeWebSocket.instances[0].fail();

        expect(wsState.wsStatus).toBe('reconnecting');
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1); // one drop → one probe
    });
});

describe('live state events — XML <updates> parsing', () => {
    it('parses the full nowPlayingUpdated payload and the device ID from <updates>', () => {
        connectSoundtouchWs('192.168.1.42');
        FakeWebSocket.instances[0].open();
        FakeWebSocket.instances[0].message(`<?xml version="1.0" encoding="UTF-8" ?>
<updates deviceID="689E19B8BB8A">
    <nowPlayingUpdated deviceID="689E19B8BB8A">
        <nowPlaying deviceID="689E19B8BB8A" source="RADIO_BROWSER">
            <track>Station name</track>
            <artist>Artist name</artist>
            <album>Album name</album>
            <playStatus>PLAY_STATE</playStatus>
        </nowPlaying>
    </nowPlayingUpdated>
</updates>`);

        expect(wsState.deviceNowPlaying).toBe('Station name');
        expect(wsState.deviceArtist).toBe('Artist name');
        expect(wsState.deviceAlbum).toBe('Album name');
        expect(wsState.deviceSource).toBe('RADIO_BROWSER');
        expect(wsState.devicePlayStatus).toBe('PLAY_STATE');
        // the deviceID attribute lives on the <updates> root
        expect(wsState.soundtouchDevice).toEqual({ id: '689E19B8BB8A' });
    });

    it.each<string>(['PLAY_STATE', 'PAUSE_STATE', 'BUFFERING_STATE', 'STOP_STATE'])('stores the playStatus %s verbatim', (playStatus) => {
        connectSoundtouchWs('192.168.1.42');
        FakeWebSocket.instances[0].open();
        FakeWebSocket.instances[0].message(NOW_PLAYING_XML('Station name', playStatus));

        expect(wsState.devicePlayStatus).toBe(playStatus);
    });

    it('maps an unknown playStatus value to an empty string', () => {
        connectSoundtouchWs('192.168.1.42');
        FakeWebSocket.instances[0].open();
        FakeWebSocket.instances[0].message(NOW_PLAYING_XML('Station name', 'PLAYING'));

        expect(wsState.devicePlayStatus).toBe('');
        expect(wsState.deviceNowPlaying).toBe('Station name'); // the rest still parses
    });

    it('parses volumeUpdated into volume and mute', () => {
        connectSoundtouchWs('192.168.1.42');
        FakeWebSocket.instances[0].open();
        FakeWebSocket.instances[0].message(VOLUME_XML(50, false));

        expect(wsState.deviceVolume).toBe(50);
        expect(wsState.deviceMute).toBe(false);
    });

    it('keeps the last-known volume/mute for signal-only events', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.message(VOLUME_XML(70, true));
        expect(wsState.deviceVolume).toBe(70);
        expect(wsState.deviceMute).toBe(true);

        ws.message('<updates deviceID="689E19B8BB8A"><volumeUpdated deviceID="689E19B8BB8A"/></updates>');
        expect(wsState.deviceVolume).toBe(70);
        expect(wsState.deviceMute).toBe(true);

        ws.message('<updates deviceID="689E19B8BB8A"><connectionStateUpdated deviceID="689E19B8BB8A"/></updates>');
        expect(wsState.deviceVolume).toBe(70);

        ws.message('<updates deviceID="689E19B8BB8A"><infoUpdated deviceID="689E19B8BB8A"/></updates>');
        expect(wsState.deviceVolume).toBe(70);
        expect(wsState.deviceMute).toBe(true);
    });

    it('ignores malformed or unknown messages without throwing, leaving state unchanged', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();

        expect(() => {
            ws.message('<updates><nowPlayingUpdated><broken');
            ws.message('not xml at all');
            ws.message('<updates deviceID="689E19B8BB8A"><presetUpdated deviceID="689E19B8BB8A"/></updates>');
        }).not.toThrow();

        expect(wsState.deviceNowPlaying).toBe('');
        expect(wsState.deviceVolume).toBe(0);
        expect(wsState.devicePlayStatus).toBe('');
        expect(wsState.soundtouchDevice).toBeNull();
    });
});

describe('connection loss & reconnection', () => {
    it('on close marks reconnecting, keeps last-known state, and probes reachability', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.message(NOW_PLAYING_XML('Station name', 'PLAY_STATE'));
        ws.message(VOLUME_XML(50, false));
        ws.closeFromServer();

        expect(wsState.wsStatus).toBe('reconnecting');
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://192.168.1.42:8090/info');
        expect(init.method).toBe('GET');
        expect(init.mode).toBe('no-cors');
        // last-known state survives the drop
        expect(wsState.deviceNowPlaying).toBe('Station name');
        expect(wsState.devicePlayStatus).toBe('PLAY_STATE');
        expect(wsState.deviceVolume).toBe(50);
        expect(wsState.deviceMute).toBe(false);
        // the probe's 5s watchdog cleared on settle; only the backoff retry is pending
        expect(vi.getTimerCount()).toBe(1);
    });

    it('retries the WebSocket with capped exponential backoff 1s→2s→4s→8s→16s→30s', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        connectSoundtouchWs('192.168.1.42');
        let ws = FakeWebSocket.instances[0];
        ws.open();
        ws.closeFromServer();
        await flush();
        expect(vi.getTimerCount()).toBe(1);

        const delays = [1000, 2000, 4000, 8000, 16000, 30000];
        for (const delay of delays) {
            await vi.advanceTimersByTimeAsync(delay);
            await flush();
            ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
            ws.closeFromServer();
            await flush();
        }

        expect(FakeWebSocket.instances).toHaveLength(1 + delays.length);
        expect(fetchMock).toHaveBeenCalledTimes(1 + delays.length);
    });

    it('resets the backoff to 1s after a successful connection', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        connectSoundtouchWs('192.168.1.42');
        let ws = FakeWebSocket.instances[0];
        ws.open();
        ws.closeFromServer();
        await flush();
        await vi.advanceTimersByTimeAsync(1000);
        await flush();
        expect(FakeWebSocket.instances).toHaveLength(2);

        ws = FakeWebSocket.instances[1];
        ws.open(); // successful connection → backoff resets to 1s
        ws.closeFromServer();
        await flush();
        await vi.advanceTimersByTimeAsync(1000);
        await flush();

        // 1000ms after the second drop — not the grown 2000ms
        expect(FakeWebSocket.instances).toHaveLength(3);
    });

    it('marks the device unreachable after 3 consecutive probe failures (offline banner, controls disabled)', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
        vi.stubGlobal('fetch', fetchMock);

        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.closeFromServer(); // probe #1 fails
        await flush();
        await vi.advanceTimersByTimeAsync(1000); // probe #2 fails
        await flush();
        expect(state.soundtouchStatus).toBe('available');

        await vi.advanceTimersByTimeAsync(2000); // probe #3 fails
        await flush();

        expect(state.soundtouchStatus).toBe('unreachable');
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(FakeWebSocket.instances).toHaveLength(1); // never a new socket

        render();
        expect(document.querySelector('.offline-banner')).not.toBeNull();
        expect((document.querySelector('#remotePlayPause') as HTMLButtonElement).disabled).toBe(true);
        expect((document.querySelector('#remoteVolume') as HTMLInputElement).disabled).toBe(true);
    });

    it('recovers to available and reconnects once a probe succeeds again', async () => {
        vi.useFakeTimers();
        const fetchMock = vi
            .fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockRejectedValueOnce(new Error('offline'))
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.closeFromServer();
        await flush();
        await vi.advanceTimersByTimeAsync(1000);
        await flush();
        await vi.advanceTimersByTimeAsync(2000);
        await flush();
        expect(state.soundtouchStatus).toBe('unreachable');
        expect(fetchMock).toHaveBeenCalledTimes(3);

        await vi.advanceTimersByTimeAsync(4000); // probe #4 succeeds
        await flush();
        expect(state.soundtouchStatus).toBe('available');
        expect(fetchMock).toHaveBeenCalledTimes(4);
        expect(vi.getTimerCount()).toBe(1); // the socket reconnect is scheduled

        await vi.advanceTimersByTimeAsync(8000);
        await flush();
        expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('ignores messages and close events from a stale socket after an address change', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        connectSoundtouchWs('192.168.1.42');
        const old = FakeWebSocket.instances[0];
        old.open();

        connectSoundtouchWs('192.168.1.43');
        expect(old.closed).toBe(true);
        expect(FakeWebSocket.instances).toHaveLength(2);

        old.message(NOW_PLAYING_XML('Stale', 'PLAY_STATE'));
        expect(wsState.deviceNowPlaying).toBe('');
        expect(wsState.devicePlayStatus).toBe('');

        old.closeFromServer();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(wsState.wsStatus).toBe('connecting'); // the new socket is still connecting
    });
});

describe('remote control panel', () => {
    it('renders the panel when an address is saved and hides it otherwise', () => {
        render();
        for (const id of ['#remotePlayPause', '#remoteNext', '#remotePrev', '#remoteMute', '#remoteVolume']) {
            expect(document.querySelector(id)).not.toBeNull();
        }

        state.soundtouchAddress = '';
        state.skippedSetup = true;
        render();
        expect(document.querySelector('#remotePlayPause')).toBeNull();
        expect(document.querySelector('#remoteVolume')).toBeNull();
    });

    it('disables the controls unless the connection is connected', () => {
        wsState.wsStatus = 'connecting';
        render();
        expect((document.querySelector('#remotePlayPause') as HTMLButtonElement).disabled).toBe(true);
        expect((document.querySelector('#remoteNext') as HTMLButtonElement).disabled).toBe(true);
        expect((document.querySelector('#remotePrev') as HTMLButtonElement).disabled).toBe(true);
        expect((document.querySelector('#remoteMute') as HTMLButtonElement).disabled).toBe(true);
        expect((document.querySelector('#remoteVolume') as HTMLInputElement).disabled).toBe(true);

        wsState.wsStatus = 'connected';
        render();
        expect((document.querySelector('#remotePlayPause') as HTMLButtonElement).disabled).toBe(false);
        expect((document.querySelector('#remoteNext') as HTMLButtonElement).disabled).toBe(false);
        expect((document.querySelector('#remotePrev') as HTMLButtonElement).disabled).toBe(false);
        expect((document.querySelector('#remoteMute') as HTMLButtonElement).disabled).toBe(false);
        expect((document.querySelector('#remoteVolume') as HTMLInputElement).disabled).toBe(false);
    });

    it('labels and icons the play/pause button from the live play status', () => {
        wsState.wsStatus = 'connected';
        wsState.devicePlayStatus = 'PLAY_STATE';
        render();
        const btn = () => document.querySelector('#remotePlayPause') as HTMLButtonElement;
        expect(btn().getAttribute('aria-label')).toBe(tView.en.remotePause);
        expect(btn().getAttribute('title')).toBe(tView.en.remotePause);
        const playIcon = btn().querySelector('svg')!.outerHTML;

        wsState.devicePlayStatus = 'PAUSE_STATE';
        render();
        expect(btn().getAttribute('aria-label')).toBe(tView.en.remotePlay);
        expect(btn().getAttribute('title')).toBe(tView.en.remotePlay);
        expect(btn().querySelector('svg')!.outerHTML).not.toBe(playIcon);
    });

    it.each<string>(['PLAY_STATE', 'PAUSE_STATE', 'BUFFERING_STATE', 'STOP_STATE'])('shows the play-status chip for %s', (playStatus) => {
        wsState.wsStatus = 'connected';
        wsState.devicePlayStatus = playStatus;
        render();
        const labels: Record<string, string> = {
            PLAY_STATE: tView.en.remotePlaying,
            PAUSE_STATE: tView.en.remotePaused,
            BUFFERING_STATE: tView.en.remoteBuffering,
            STOP_STATE: tView.en.remoteStopped,
        };
        expect(document.querySelector('#app')!.textContent).toContain(labels[playStatus]);
    });

    it('renders no play-status chip when the play status is empty', () => {
        wsState.wsStatus = 'connected';
        wsState.devicePlayStatus = '';
        render();
        const text = document.querySelector('#app')!.textContent!;
        expect(text).not.toContain(tView.en.remotePlaying);
        expect(text).not.toContain(tView.en.remotePaused);
        expect(text).not.toContain(tView.en.remoteBuffering);
        expect(text).not.toContain(tView.en.remoteStopped);
    });

    it('mirrors the WebSocket-confirmed volume in the slider', () => {
        wsState.wsStatus = 'connected';
        wsState.deviceVolume = 42;
        render();
        expect((document.querySelector('#remoteVolume') as HTMLInputElement).value).toBe('42');
    });

    it('labels and icons the mute button from the WebSocket-confirmed mute state', () => {
        wsState.wsStatus = 'connected';
        wsState.deviceMute = false;
        render();
        const btn = () => document.querySelector('#remoteMute') as HTMLButtonElement;
        expect(btn().getAttribute('aria-label')).toBe(tView.en.remoteMute);
        expect(btn().getAttribute('title')).toBe(tView.en.remoteMute);
        const unmutedIcon = btn().querySelector('svg')!.outerHTML;

        wsState.deviceMute = true;
        render();
        expect(btn().getAttribute('aria-label')).toBe(tView.en.remoteUnmute);
        expect(btn().getAttribute('title')).toBe(tView.en.remoteUnmute);
        expect(btn().querySelector('svg')!.outerHTML).not.toBe(unmutedIcon);
    });

    it('renderRemotePanel returns the five remote control ids when connected', () => {
        wsState.wsStatus = 'connected';
        wsState.devicePlayStatus = 'PLAY_STATE';
        const html = renderRemotePanel(state, getLabels(state));

        expect(html).toContain('id="remotePlayPause"');
        expect(html).toContain('id="remoteNext"');
        expect(html).toContain('id="remotePrev"');
        expect(html).toContain('id="remoteMute"');
        expect(html).toContain('id="remoteVolume"');
    });

    it('adds non-empty remote-control labels in all four languages', () => {
        const keys = ['remoteTitle', 'remoteConnected', 'remoteReconnecting', 'remotePlay', 'remotePause', 'remoteNext', 'remotePrev', 'remoteMute', 'remoteUnmute', 'remoteVolume', 'remotePlaying', 'remotePaused', 'remoteBuffering', 'remoteStopped'];
        for (const lang of ['en', 'de', 'ru', 'ukr'] as const) {
            for (const key of keys) {
                expect(tView[lang][key]?.trim()).toBeTruthy();
            }
        }
    });
});

describe('remote controls — delegated events', () => {
    it('play/pause sends PLAY press+release when the device is not playing', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        wsState.wsStatus = 'connected';
        wsState.devicePlayStatus = 'PAUSE_STATE';
        render();
        setupEvents();

        document.querySelector<HTMLButtonElement>('#remotePlayPause')!.click();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

        const press = fetchMock.mock.calls[0] as [string, RequestInit];
        const release = fetchMock.mock.calls[1] as [string, RequestInit];
        expect(press[0]).toBe('http://192.168.1.42:8090/key');
        expect(release[0]).toBe('http://192.168.1.42:8090/key');
        expect(press[1].method).toBe('POST');
        expect(press[1].mode).toBe('no-cors');
        expect(new Headers(press[1].headers as HeadersInit).get('Content-Type')).toBe('text/plain;charset=UTF-8');
        expect(String(press[1].body)).toBe('<key state="press" sender="Gabbo">PLAY</key>');
        expect(String(release[1].body)).toBe('<key state="release" sender="Gabbo">PLAY</key>');
        // no echo loop: the command POSTs never write live device state
        expect(wsState.devicePlayStatus).toBe('PAUSE_STATE');
    });

    it('play/pause sends PAUSE press+release while the device is playing', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        wsState.wsStatus = 'connected';
        wsState.devicePlayStatus = 'PLAY_STATE';
        render();
        setupEvents();

        document.querySelector<HTMLButtonElement>('#remotePlayPause')!.click();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

        expect(String(fetchMock.mock.calls[0][1].body)).toBe('<key state="press" sender="Gabbo">PAUSE</key>');
        expect(String(fetchMock.mock.calls[1][1].body)).toBe('<key state="release" sender="Gabbo">PAUSE</key>');
        expect(wsState.devicePlayStatus).toBe('PLAY_STATE');
    });

    it('next/prev send NEXT_TRACK/PREV_TRACK and mute posts muteenabled', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        wsState.wsStatus = 'connected';
        wsState.deviceMute = false;
        render();
        setupEvents();

        document.querySelector<HTMLButtonElement>('#remoteNext')!.click();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(String(fetchMock.mock.calls[0][1].body)).toBe('<key state="press" sender="Gabbo">NEXT_TRACK</key>');
        expect(String(fetchMock.mock.calls[1][1].body)).toBe('<key state="release" sender="Gabbo">NEXT_TRACK</key>');

        document.querySelector<HTMLButtonElement>('#remotePrev')!.click();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
        expect(String(fetchMock.mock.calls[2][1].body)).toBe('<key state="press" sender="Gabbo">PREV_TRACK</key>');
        expect(String(fetchMock.mock.calls[3][1].body)).toBe('<key state="release" sender="Gabbo">PREV_TRACK</key>');

        document.querySelector<HTMLButtonElement>('#remoteMute')!.click();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
        const [url, init] = fetchMock.mock.calls[4] as [string, RequestInit];
        expect(url).toBe('http://192.168.1.42:8090/volume');
        expect(init.method).toBe('POST');
        expect(init.mode).toBe('no-cors');
        expect(new Headers(init.headers as HeadersInit).get('Content-Type')).toBe('text/plain;charset=UTF-8');
        expect(String(init.body)).toBe('<volume><muteenabled>true</muteenabled></volume>');
        // no echo loop
        expect(wsState.deviceMute).toBe(false);
    });

    it('sends NEXT_TRACK when the click target is the inner svg or path of #remoteNext', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        wsState.wsStatus = 'connected';
        render();
        setupEvents();

        document.querySelector('#remoteNext svg')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(String(fetchMock.mock.calls[0][1].body)).toBe('<key state="press" sender="Gabbo">NEXT_TRACK</key>');
        expect(String(fetchMock.mock.calls[1][1].body)).toBe('<key state="release" sender="Gabbo">NEXT_TRACK</key>');

        document.querySelector('#remoteNext path')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
        expect(String(fetchMock.mock.calls[2][1].body)).toBe('<key state="press" sender="Gabbo">NEXT_TRACK</key>');
        expect(String(fetchMock.mock.calls[3][1].body)).toBe('<key state="release" sender="Gabbo">NEXT_TRACK</key>');
    });

    it('the volume slider sends one debounced volume POST and never writes state', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        wsState.wsStatus = 'connected';
        wsState.deviceVolume = 30;
        render();
        setupEvents();

        const slider = document.querySelector('#remoteVolume') as HTMLInputElement;
        slider.value = '55';
        slider.dispatchEvent(new Event('change', { bubbles: true }));

        expect(fetchMock).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(400);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://192.168.1.42:8090/volume');
        expect(String(init.body)).toBe('<volume>55</volume>');
        // the slider value only ever updates from WebSocket events
        expect(wsState.deviceVolume).toBe(30);
    });

    it('ignores remote control input while reconnecting (zero POSTs)', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        wsState.wsStatus = 'reconnecting';
        render();
        setupEvents();

        // dispatchEvent bypasses the disabled attribute — the delegated
        // handler itself must guard on the connection state.
        for (const id of ['#remotePlayPause', '#remoteNext', '#remotePrev', '#remoteMute']) {
            document.querySelector(id)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        const slider = document.querySelector('#remoteVolume') as HTMLInputElement;
        slider.value = '77';
        slider.dispatchEvent(new Event('change', { bubbles: true }));

        expect(fetchMock).not.toHaveBeenCalled();
    });
});
