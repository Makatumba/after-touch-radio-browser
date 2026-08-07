import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, state } from '../src/app';
import { setupEvents } from '../src/events';
import { checkSoundtouchOnStartup, closeSoundtouchWs, connectSoundtouchWs, requestSnapshot } from '../src/soundtouch-ws';
import { renderRemotePanel } from '../src/components/remote';
import { getLabels, translations } from '../src/i18n';
import { defaultSettings } from '../src/settings';
import { getAudioElement } from '../src/player';
import { loadArtworkCache, resetArtworkState } from '../src/artwork';

const LS_LANGUAGE = 'radio-browser-language';
const LS_SOUNDTOUCH = 'radio-browser-soundtouch-host';
const LS_FAVORITES = 'radio-browser-favorites';
const LS_SETTINGS = 'radio-browser-settings';

// The FR-3 verbose extension lands in src/state.ts with the implementation
// wave: State gains deviceNowPlayingDetail and soundtouchDevice grows to the
// full DeviceInfo shape. Until then both are accessed through this typed view
// so the file stays type-clean at every commit in the sequence.
interface DeviceNowPlayingVerbose {
    stationName: string;
    art: string;
    artImageStatus: string;
    contentItem: {
        source: string;
        type: string;
        location: string;
        sourceAccount: string;
        itemName: string;
        containerArt: string;
    } | null;
    sourceAccount: string;
    timeTotal: number | null;
    timePosition: string;
    skipEnabled: boolean;
    skipPreviousEnabled: boolean;
    favoriteEnabled: boolean;
    seekSupported: boolean;
    shuffleSetting: string;
    repeatSetting: string;
    streamType: string;
    trackId: string;
    position: string;
    description: string;
    stationLocation: string;
}

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
    deviceNowPlayingDetail: DeviceNowPlayingVerbose | null;
    soundtouchDevice: DeviceInfo | null;
};

// i18n gains the remote-panel keys with the FR-3 implementation wave; until
// then the dictionary is accessed through this typed view.
const tView = translations as unknown as Record<string, Record<string, string>>;

// Wave 6: Settings gains hideRemoteSkipButtons (default true — the remote's
// next/prev render only when it is false). Until src/state.ts + src/settings.ts
// change, the tests that opt out of skip-hiding write through this typed view.
const settingsView = state as unknown as {
    settings: { enablePreview: boolean; hideRemoteSkipButtons: boolean };
};

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
    // (the FR-3 snapshot requests land here on open once implemented)
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

// jsdom never fires Image load/error events. The artwork module must resolve
// `Image` at request time (plain global lookup) for this stub to be seen —
// capturing it at module load would make every remote-art test here fail.
class FakeImage {
    static instances: FakeImage[] = [];
    src = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor() {
        FakeImage.instances.push(this);
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

// FR-3 snapshot wire contract (API-NOTES.md "State snapshot"): the url attribute
// carries no leading slash, the deviceID attribute is required but may be empty,
// and the requestID counts per request, resetting to 1 on every connection.
const SNAPSHOT_REQUEST_XML = (deviceId: string, name: string, requestId: number) =>
    `<msg><header deviceID="${deviceId}" url="${name}" method="GET"><request requestID="${requestId}"><info type="new"/></request></header><body/></msg>`;

// RESPONSE envelopes — same payload shapes the <updates> events carry, so the
// app's defensive field mapping applies 1:1 (requestID is not correlated).
const NOW_PLAYING_RESPONSE_XML = (track: string, playStatus: string, source = 'RADIO_BROWSER') =>
    `<msg><header deviceID="689E19B8BB8A" url="now_playing" method="GET" msgType="RESPONSE"><request requestID="1"/></header><body><nowPlaying source="${source}"><track>${track}</track><artist>Artist name</artist><album>Album name</album><playStatus>${playStatus}</playStatus></nowPlaying></body></msg>`;

const VOLUME_RESPONSE_XML = (volume: number, mute: boolean) =>
    `<msg><header deviceID="689E19B8BB8A" url="volume" method="GET" msgType="RESPONSE"><request requestID="2"/></header><body><volume><targetvolume>${volume}</targetvolume><actualvolume>${volume}</actualvolume><muteenabled>${mute}</muteenabled></volume></body></msg>`;

const INFO_RESPONSE_XML = (name: string | null, type: string | null) =>
    `<msg><header deviceID="689E19B8BB8A" url="info" method="GET" msgType="RESPONSE"><request requestID="3"/></header><body><info deviceID="689E19B8BB8A">${name ? `<name>${name}</name>` : ''}${type ? `<type>${type}</type>` : ''}</info></body></msg>`;

// Verbose now-playing payload factory — the pinned wire shape from API-NOTES.md
// "Full now-playing payload". The skip/favorite presence elements are emitted
// only when the flag is on (present = enabled); seekSupported carries a value
// attribute, not chardata. The same <nowPlaying> body goes into pushed
// <updates> events and snapshot RESPONSE bodies.
const verboseNowPlayingBody = (opts: {
    track?: string;
    stationName?: string;
    art?: string;
    artImageStatus?: string;
    itemName?: string;
    containerArt?: string;
    skipEnabled?: boolean;
    skipPreviousEnabled?: boolean;
    favoriteEnabled?: boolean;
    seekSupported?: boolean;
    source?: string;
    sourceAccount?: string;
    description?: string;
    playStatus?: string;
} = {}): string => {
    const {
        track = 'Track title',
        stationName = 'Station name',
        art = 'http://192.168.1.42:8090/v1/art.png',
        artImageStatus = 'IMAGE_PRESENT',
        itemName = 'Station name',
        containerArt = 'http://192.168.1.42:8090/v1/container-art.png',
        skipEnabled = true,
        skipPreviousEnabled = true,
        favoriteEnabled = true,
        seekSupported = false,
        source = 'RADIO_BROWSER',
        sourceAccount = 'alice@example.com',
        description = 'Station description',
        playStatus = 'PLAY_STATE',
    } = opts;
    return `<nowPlaying deviceID="689E19B8BB8A" source="${source}" sourceAccount="${sourceAccount}">
    <track>${track}</track>
    <artist>Artist name</artist>
    <album>Album name</album>
    <stationName>${stationName}</stationName>
    <art artImageStatus="${artImageStatus}">${art}</art>
    <ContentItem source="${source}" type="STATION" location="/v1/play/1" sourceAccount="${sourceAccount}">
        <itemName>${itemName}</itemName>
        <containerArt>${containerArt}</containerArt>
    </ContentItem>
    <time total="0">0</time>
    ${skipEnabled ? '<skipEnabled/>' : ''}
    ${skipPreviousEnabled ? '<skipPreviousEnabled/>' : ''}
    ${favoriteEnabled ? '<favoriteEnabled/>' : ''}
    <seekSupported value="${seekSupported}"/>
    <shuffleSetting>SHUFFLE_OFF</shuffleSetting>
    <repeatSetting>REPEAT_OFF</repeatSetting>
    <streamType>RADIO</streamType>
    <trackID>track-42</trackID>
    <position>0</position>
    <description>${description}</description>
    <stationLocation>Berlin, Germany</stationLocation>
    <playStatus>${playStatus}</playStatus>
</nowPlaying>`;
};

const VERBOSE_NOW_PLAYING_XML = (opts?: Parameters<typeof verboseNowPlayingBody>[0]) =>
    `<updates deviceID="689E19B8BB8A"><nowPlayingUpdated deviceID="689E19B8BB8A">${verboseNowPlayingBody(opts)}</nowPlayingUpdated></updates>`;

const VERBOSE_NOW_PLAYING_RESPONSE_XML = (opts?: Parameters<typeof verboseNowPlayingBody>[0]) =>
    `<msg><header deviceID="689E19B8BB8A" url="now_playing" method="GET" msgType="RESPONSE"><request requestID="1"/></header><body>${verboseNowPlayingBody(opts)}</body></msg>`;

// Full device-info payload — pinned in API-NOTES.md "Device info". The header
// deviceID deliberately differs from the <info> element's own deviceID attr so
// the id source is unambiguous (for info, the element's own attr wins).
const FULL_INFO_RESPONSE_XML = () =>
    `<msg><header deviceID="000000000000" url="info" method="GET" msgType="RESPONSE"><request requestID="3"/></header><body><info deviceID="689E19B8BB8A">
    <name>Bose SoundTouch B9B8BC</name>
    <type>SoundTouch 10</type>
    <moduleType>soundtouch</moduleType>
    <variant>Variant XYZ</variant>
    <variantMode>normal</variantMode>
    <countryCode>DE</countryCode>
    <regionCode>EU</regionCode>
    <networkInfo type="WIRED">
        <macAddress>68:9E:19:B8:BB:8A</macAddress>
        <ipAddress>192.168.1.42</ipAddress>
    </networkInfo>
    <components>
        <component>
            <componentCategory>SoundTouch</componentCategory>
            <softwareVersion>3.8.8.2</softwareVersion>
            <serialNumber>SN-1234</serialNumber>
        </component>
    </components>
    <margeURL>https://marge.example.com</margeURL>
    <margeAccountUUID>uuid-1</margeAccountUUID>
</info></body></msg>`;

// The full verbose detail the parser must produce for the fixtures above, and
// the empty-string defaults it must produce for the minimal payload. The
// parser stores raw values only — fallback chaining is the components' job.
const FULL_VERBOSE_DETAIL: DeviceNowPlayingVerbose = {
    stationName: 'Station name',
    art: 'http://192.168.1.42:8090/v1/art.png',
    artImageStatus: 'IMAGE_PRESENT',
    contentItem: {
        source: 'RADIO_BROWSER',
        type: 'STATION',
        location: '/v1/play/1',
        sourceAccount: 'alice@example.com',
        itemName: 'Station name',
        containerArt: 'http://192.168.1.42:8090/v1/container-art.png',
    },
    sourceAccount: 'alice@example.com',
    timeTotal: 0,
    timePosition: '0',
    skipEnabled: true,
    skipPreviousEnabled: true,
    favoriteEnabled: true,
    seekSupported: false,
    shuffleSetting: 'SHUFFLE_OFF',
    repeatSetting: 'REPEAT_OFF',
    streamType: 'RADIO',
    trackId: 'track-42',
    position: '0',
    description: 'Station description',
    stationLocation: 'Berlin, Germany',
};

const EMPTY_VERBOSE_DETAIL: DeviceNowPlayingVerbose = {
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
};

// Builds a detail object for component-level tests (the components must
// tolerate any combination of present/absent verbose fields).
const detail = (overrides: Partial<DeviceNowPlayingVerbose> = {}): DeviceNowPlayingVerbose => ({
    ...EMPTY_VERBOSE_DETAIL,
    ...overrides,
});

const contentItem = (overrides: Partial<NonNullable<DeviceNowPlayingVerbose['contentItem']>> = {}): NonNullable<DeviceNowPlayingVerbose['contentItem']> => ({
    source: '',
    type: '',
    location: '',
    sourceAccount: '',
    itemName: '',
    containerArt: '',
    ...overrides,
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
    wsState.deviceNowPlayingDetail = null;
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

describe('state snapshot — sent on connection open', () => {
    it('sends exactly three snapshot requests in order now_playing, volume, info', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();

        expect(ws.sent).toHaveLength(3);
        expect(ws.sent[0]).toBe(SNAPSHOT_REQUEST_XML('', 'now_playing', 1));
        expect(ws.sent[1]).toBe(SNAPSHOT_REQUEST_XML('', 'volume', 2));
        expect(ws.sent[2]).toBe(SNAPSHOT_REQUEST_XML('', 'info', 3));
        // pinned REST-proxy shape: no leading slash on url, requestID per request
        for (const sent of ws.sent) {
            expect(sent).toMatch(/url="[^/][^"]*"/);
            expect(sent).toContain('<request requestID="');
            expect(sent).toContain('<info type="new"/>');
            expect(sent).toContain('<body/>');
        }
    });

    it('sends an empty deviceID attribute when no device is known yet', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();

        expect(ws.sent).toHaveLength(3);
        for (const sent of ws.sent) {
            expect(sent).toContain('<header deviceID=""');
        }
    });

    it('sends the known device MAC in the headers after an event established it', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        connectSoundtouchWs('192.168.1.42');
        const first = FakeWebSocket.instances[0];
        first.open();
        first.message(NOW_PLAYING_XML('Station name', 'PLAY_STATE'));
        expect(wsState.soundtouchDevice).toEqual({ id: '689E19B8BB8A' });

        first.closeFromServer();
        await flush();
        await vi.advanceTimersByTimeAsync(1000);
        await flush();

        const second = FakeWebSocket.instances[1];
        second.open();
        expect(second.sent).toHaveLength(3);
        expect(second.sent[0]).toBe(SNAPSHOT_REQUEST_XML('689E19B8BB8A', 'now_playing', 1));
        expect(second.sent[1]).toBe(SNAPSHOT_REQUEST_XML('689E19B8BB8A', 'volume', 2));
        expect(second.sent[2]).toBe(SNAPSHOT_REQUEST_XML('689E19B8BB8A', 'info', 3));
    });

    it('resets the requestID sequence to 1,2,3 on every connection', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        connectSoundtouchWs('192.168.1.42');
        const first = FakeWebSocket.instances[0];
        first.open();
        expect(first.sent.map(s => s.match(/requestID="(\d+)"/)?.[1])).toEqual(['1', '2', '3']);

        first.closeFromServer();
        await flush();
        await vi.advanceTimersByTimeAsync(1000);
        await flush();

        const second = FakeWebSocket.instances[1];
        second.open();
        expect(second.sent).toHaveLength(3);
        expect(second.sent.map(s => s.match(/requestID="(\d+)"/)?.[1])).toEqual(['1', '2', '3']);
    });

    it('sending the snapshot writes no live state (no echo loop)', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();

        expect(ws.sent).toHaveLength(3);
        expect(wsState.deviceNowPlaying).toBe('');
        expect(wsState.deviceArtist).toBe('');
        expect(wsState.deviceAlbum).toBe('');
        expect(wsState.deviceSource).toBe('');
        expect(wsState.devicePlayStatus).toBe('');
        expect(wsState.deviceVolume).toBe(0);
        expect(wsState.deviceMute).toBe(false);
        expect(wsState.soundtouchDevice).toBeNull();
    });
});

describe('state snapshot — re-requested on (re)connection check', () => {
    it('re-sends the three requests in order when the connection is open', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        expect(ws.sent).toHaveLength(3);

        requestSnapshot();
        expect(ws.sent).toHaveLength(6);
        expect(ws.sent[3]).toBe(SNAPSHOT_REQUEST_XML('', 'now_playing', 4));
        expect(ws.sent[4]).toBe(SNAPSHOT_REQUEST_XML('', 'volume', 5));
        expect(ws.sent[5]).toBe(SNAPSHOT_REQUEST_XML('', 'info', 6));
        // no echo loop: the re-request writes no live state
        expect(wsState.soundtouchDevice).toBeNull();
        expect(wsState.deviceNowPlaying).toBe('');
        expect(wsState.deviceArtist).toBe('');
        expect(wsState.deviceAlbum).toBe('');
        expect(wsState.deviceSource).toBe('');
        expect(wsState.devicePlayStatus).toBe('');
        expect(wsState.deviceVolume).toBe(0);
        expect(wsState.deviceMute).toBe(false);
    });

    it('repeated checks keep incrementing the requestID', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        expect(ws.sent).toHaveLength(3);

        requestSnapshot();
        expect(ws.sent).toHaveLength(6);
        expect(ws.sent[5]).toBe(SNAPSHOT_REQUEST_XML('', 'info', 6));

        requestSnapshot();
        expect(ws.sent).toHaveLength(9);
        expect(ws.sent.map(s => s.match(/requestID="(\d+)"/)?.[1])).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    });

    it('sends nothing while the socket is still connecting', () => {
        connectSoundtouchWs('192.168.1.42');
        // do NOT open the socket

        expect(() => requestSnapshot()).not.toThrow();
        expect(FakeWebSocket.instances[0].sent).toHaveLength(0);
    });

    it('sends nothing while reconnecting', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        expect(ws.sent).toHaveLength(3);

        ws.closeFromServer();
        await flush();
        expect(wsState.wsStatus).toBe('reconnecting');

        expect(() => requestSnapshot()).not.toThrow();
        expect(ws.sent).toHaveLength(3);
    });

    it('a successful drop-recovery probe does not send on the closed socket; the reopened socket snapshots fresh 1,2,3', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        connectSoundtouchWs('192.168.1.42');
        const first = FakeWebSocket.instances[0];
        first.open();
        expect(first.sent).toHaveLength(3);

        first.closeFromServer();
        await flush();
        expect(first.sent).toHaveLength(3); // probe ok, runProbe's requestSnapshot() no-ops while the socket is closed

        await vi.advanceTimersByTimeAsync(1000);
        await flush();
        const second = FakeWebSocket.instances[1];
        second.open();
        expect(second.sent).toHaveLength(3);
        expect(second.sent[0]).toBe(SNAPSHOT_REQUEST_XML('', 'now_playing', 1));
        expect(second.sent[1]).toBe(SNAPSHOT_REQUEST_XML('', 'volume', 2));
        expect(second.sent[2]).toBe(SNAPSHOT_REQUEST_XML('', 'info', 3));
    });

    it('a failed drop-recovery probe sends nothing', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
        vi.stubGlobal('fetch', fetchMock);

        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        expect(ws.sent).toHaveLength(3);

        ws.closeFromServer();
        await flush();
        expect(ws.sent).toHaveLength(3);
    });

    it('saving an address re-requests the snapshot after the probe succeeds', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        state.soundtouchAddress = '';
        state.skippedSetup = true;
        render();
        setupEvents();

        // wave 7: the host field lives in the settings popup's SoundTouch
        // section, not in a shell bar
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        const input = document.querySelector<HTMLInputElement>('#settingSoundtouchHost');
        expect(input).not.toBeNull();
        input!.value = '192.168.1.42';
        document.querySelector<HTMLButtonElement>('#settingSoundtouchSave')!.click();

        const ws = FakeWebSocket.instances[0];
        ws.open();
        expect(ws.sent).toHaveLength(3);

        await flush(); // probe resolves ok → the save handler calls requestSnapshot()
        expect(ws.sent).toHaveLength(6);
        expect(ws.sent[5]).toBe(SNAPSHOT_REQUEST_XML('', 'info', 6));
    });

    it('the startup check re-requests the snapshot once the probe succeeds', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        state.soundtouchAddress = '192.168.1.42';
        state.soundtouchStatus = 'checking';
        checkSoundtouchOnStartup('192.168.1.42');

        const ws = FakeWebSocket.instances[0];
        ws.open();
        expect(ws.sent).toHaveLength(3);

        await flush();
        expect(state.soundtouchStatus).toBe('available');
        expect(ws.sent).toHaveLength(6);
        expect(ws.sent[3]).toBe(SNAPSHOT_REQUEST_XML('', 'now_playing', 4));
        expect(ws.sent[4]).toBe(SNAPSHOT_REQUEST_XML('', 'volume', 5));
        expect(ws.sent[5]).toBe(SNAPSHOT_REQUEST_XML('', 'info', 6));
    });

    it('a failed startup check marks the speaker unreachable and sends nothing', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
        vi.stubGlobal('fetch', fetchMock);

        checkSoundtouchOnStartup('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        expect(ws.sent).toHaveLength(3);

        await flush();
        expect(state.soundtouchStatus).toBe('unreachable');
        expect(ws.sent).toHaveLength(3);
    });

    it('a startup check that outlives an address change applies nothing', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        state.soundtouchAddress = '192.168.1.42';
        checkSoundtouchOnStartup('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        expect(ws.sent).toHaveLength(3);

        state.soundtouchAddress = '192.168.1.43'; // the user re-saved during the probe
        await flush();
        expect(state.soundtouchStatus).toBe('checking'); // stale probe applied nothing
        expect(ws.sent).toHaveLength(3);
    });
});

describe('state snapshot — RESPONSE parsing', () => {
    it('parses a now_playing RESPONSE into now playing state and the header deviceID', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.message(NOW_PLAYING_RESPONSE_XML('Station name', 'PLAY_STATE'));

        expect(wsState.deviceNowPlaying).toBe('Station name');
        expect(wsState.deviceArtist).toBe('Artist name');
        expect(wsState.deviceAlbum).toBe('Album name');
        expect(wsState.deviceSource).toBe('RADIO_BROWSER');
        expect(wsState.devicePlayStatus).toBe('PLAY_STATE');
        expect(wsState.soundtouchDevice).toEqual({ id: '689E19B8BB8A' });
    });

    it('maps an unknown playStatus in a RESPONSE to an empty string (shared whitelist)', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.message(NOW_PLAYING_RESPONSE_XML('Station name', 'PLAYING'));

        expect(wsState.devicePlayStatus).toBe('');
        expect(wsState.deviceNowPlaying).toBe('Station name'); // the rest still parses
    });

    it('parses a volume RESPONSE into volume and mute', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.message(VOLUME_RESPONSE_XML(50, false));

        expect(wsState.deviceVolume).toBe(50);
        expect(wsState.deviceMute).toBe(false);
    });

    it('keeps the updates-path volume precedence in a RESPONSE (actualvolume preferred)', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();

        ws.message('<msg><header deviceID="689E19B8BB8A" url="volume" method="GET" msgType="RESPONSE"><request requestID="2"/></header><body><volume><targetvolume>80</targetvolume><actualvolume>42</actualvolume><muteenabled>true</muteenabled></volume></body></msg>');
        expect(wsState.deviceVolume).toBe(42);
        expect(wsState.deviceMute).toBe(true);

        // a target-only payload still applies (fallback, same as updates)
        ws.message('<msg><header deviceID="689E19B8BB8A" url="volume" method="GET" msgType="RESPONSE"><request requestID="2"/></header><body><volume><targetvolume>77</targetvolume></volume></body></msg>');
        expect(wsState.deviceVolume).toBe(77);
    });

    it('parses an info RESPONSE into the device id, name, and type', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.message(INFO_RESPONSE_XML('Bose SoundTouch B9B8BC', 'SoundTouch 10'));

        expect(wsState.soundtouchDevice).toEqual({ id: '689E19B8BB8A', name: 'Bose SoundTouch B9B8BC', type: 'SoundTouch 10' });
    });

    it('stores only the id for an info RESPONSE without name/type and renders one row', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.message('<msg><header deviceID="689E19B8BB8A" url="info" method="GET" msgType="RESPONSE"><request requestID="3"/></header><body><info deviceID="689E19B8BB8A"/></body></msg>');

        expect(wsState.soundtouchDevice).toEqual({ id: '689E19B8BB8A' });
        expect(wsState.soundtouchDevice).not.toHaveProperty('name');
        expect(wsState.soundtouchDevice).not.toHaveProperty('type');

        render();
        // wave 7: the info widget lives in the settings popup's SoundTouch
        // section — open the popup and assert the row there
        setupEvents();
        document.querySelector<HTMLButtonElement>('#openSettings')!.click();
        expect(document.querySelectorAll('.modal-overlay .soundtouch-info-row')).toHaveLength(1);
        expect(document.querySelector('.modal-overlay .soundtouch-info-body')!.textContent).toContain('689E19B8BB8A');
    });

    it('applies three RESPONSEs on one connection independently', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();

        ws.message(NOW_PLAYING_RESPONSE_XML('Station name', 'PLAY_STATE'));
        ws.message(VOLUME_RESPONSE_XML(42, true));
        ws.message(INFO_RESPONSE_XML('Bose SoundTouch B9B8BC', 'SoundTouch 10'));

        expect(wsState.deviceNowPlaying).toBe('Station name');
        expect(wsState.deviceArtist).toBe('Artist name');
        expect(wsState.deviceVolume).toBe(42);
        expect(wsState.deviceMute).toBe(true);
        expect(wsState.soundtouchDevice).toEqual({ id: '689E19B8BB8A', name: 'Bose SoundTouch B9B8BC', type: 'SoundTouch 10' });
    });

    it('is never fatal: unknown or malformed RESPONSEs leave state unchanged and the socket keeps working', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();

        expect(() => {
            // <msg> with no header at all
            ws.message('<msg><body>not a header</body></msg>');
            // header without msgType="RESPONSE" (a request echoed back)
            ws.message('<msg><header deviceID="689E19B8BB8A" url="now_playing" method="GET"><request requestID="1"><info type="new"/></request></header><body/></msg>');
            // msgType="ERROR"
            ws.message('<msg><header deviceID="689E19B8BB8A" url="now_playing" method="GET" msgType="ERROR"><request requestID="1"/></header><body><nowPlaying><track>Ignored</track></nowPlaying></body></msg>');
            // empty body
            ws.message('<msg><header deviceID="689E19B8BB8A" url="now_playing" method="GET" msgType="RESPONSE"><request requestID="1"/></header><body/></msg>');
            // unknown payload
            ws.message('<msg><header deviceID="689E19B8BB8A" url="now_playing" method="GET" msgType="RESPONSE"><request requestID="1"/></header><body><preset id="1">Ignored</preset></body></msg>');
            // malformed XML
            ws.message('<msg><header deviceID="689E19B8BB8A" url="now_playing" method="GET" msgType="RESPONSE"><request requestID="1"/></header><body><broken');
            // parsererror
            ws.message('not xml at all');
        }).not.toThrow();

        expect(wsState.deviceNowPlaying).toBe('');
        expect(wsState.deviceArtist).toBe('');
        expect(wsState.deviceAlbum).toBe('');
        expect(wsState.deviceVolume).toBe(0);
        expect(wsState.devicePlayStatus).toBe('');
        expect(wsState.soundtouchDevice).toBeNull();

        // the same connection still processes a valid RESPONSE afterwards
        ws.message(NOW_PLAYING_RESPONSE_XML('Station name', 'PLAY_STATE'));
        expect(wsState.deviceNowPlaying).toBe('Station name');
    });

    it('keeps the panel blank with zero timers when no RESPONSE arrives', () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);

        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();

        expect(ws.sent).toHaveLength(3);
        expect(wsState.wsStatus).toBe('connected');
        expect(wsState.deviceNowPlaying).toBe('');
        expect(wsState.deviceArtist).toBe('');
        expect(wsState.deviceAlbum).toBe('');
        expect(wsState.deviceVolume).toBe(0);
        expect(wsState.deviceMute).toBe(false);
        expect(wsState.soundtouchDevice).toBeNull();
        expect(vi.getTimerCount()).toBe(0);

        render();
        const text = document.querySelector('#app')!.textContent!;
        expect(text).toContain(tView.en.noStationPlaying); // blank panel, not a stale track
        expect(text).not.toContain(tView.en.remotePlaying);
        expect(text).not.toContain(tView.en.remotePaused);
    });

    it('ignores RESPONSEs from a stale socket after an address change', () => {
        connectSoundtouchWs('192.168.1.42');
        const old = FakeWebSocket.instances[0];
        old.open();
        old.message(NOW_PLAYING_XML('Station name', 'PLAY_STATE'));
        expect(wsState.soundtouchDevice).toEqual({ id: '689E19B8BB8A' });

        connectSoundtouchWs('192.168.1.43'); // address change clears the device state
        expect(old.closed).toBe(true);
        expect(FakeWebSocket.instances).toHaveLength(2);
        expect(wsState.soundtouchDevice).toBeNull();

        old.message(NOW_PLAYING_RESPONSE_XML('Stale', 'PLAY_STATE'));
        expect(wsState.deviceNowPlaying).toBe('');
        expect(wsState.devicePlayStatus).toBe('');

        old.message(INFO_RESPONSE_XML('Stale Bose', 'SoundTouch 10'));
        expect(wsState.soundtouchDevice).toBeNull();

        // the new connection's state is untouched and it starts its own snapshot
        expect(wsState.wsStatus).toBe('connecting');
        const fresh = FakeWebSocket.instances[1];
        expect(fresh.sent).toHaveLength(0);
        fresh.open();
        expect(fresh.sent).toHaveLength(3);
        expect(fresh.sent[0]).toBe(SNAPSHOT_REQUEST_XML('', 'now_playing', 1));
        expect(fresh.sent[1]).toBe(SNAPSHOT_REQUEST_XML('', 'volume', 2));
        expect(fresh.sent[2]).toBe(SNAPSHOT_REQUEST_XML('', 'info', 3));
        expect(wsState.deviceNowPlaying).toBe(''); // the stale RESPONSE never applied
    });
});

describe('verbose now-playing — full payload parsing (FR-3 extension)', () => {
    it('parses every verbose field from a nowPlayingUpdated event alongside the flat fields', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.message(VERBOSE_NOW_PLAYING_XML());

        // the flat fields still land as before
        expect(wsState.deviceNowPlaying).toBe('Track title');
        expect(wsState.deviceArtist).toBe('Artist name');
        expect(wsState.deviceAlbum).toBe('Album name');
        expect(wsState.deviceSource).toBe('RADIO_BROWSER');
        expect(wsState.devicePlayStatus).toBe('PLAY_STATE');
        expect(wsState.soundtouchDevice).toEqual({ id: '689E19B8BB8A' });

        expect(wsState.deviceNowPlayingDetail).toEqual(FULL_VERBOSE_DETAIL);
    });

    it('parses absent skip/favorite presence elements as false', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.message(VERBOSE_NOW_PLAYING_XML({skipEnabled: false, skipPreviousEnabled: false, favoriteEnabled: false}));

        expect(wsState.deviceNowPlayingDetail).not.toBeNull();
        expect(wsState.deviceNowPlayingDetail!.skipEnabled).toBe(false);
        expect(wsState.deviceNowPlayingDetail!.skipPreviousEnabled).toBe(false);
        expect(wsState.deviceNowPlayingDetail!.favoriteEnabled).toBe(false);
    });

    it('reads seekSupported from the value attribute', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.message(VERBOSE_NOW_PLAYING_XML({seekSupported: true}));
        expect(wsState.deviceNowPlayingDetail).not.toBeNull();
        expect(wsState.deviceNowPlayingDetail!.seekSupported).toBe(true);

        ws.message(VERBOSE_NOW_PLAYING_XML({seekSupported: false}));
        expect(wsState.deviceNowPlayingDetail!.seekSupported).toBe(false);
    });

    it('creates a detail object with empty-string defaults for the minimal payload', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.message(NOW_PLAYING_XML('Station name', 'PLAY_STATE'));

        expect(wsState.deviceNowPlaying).toBe('Station name');
        expect(wsState.deviceNowPlayingDetail).toEqual(EMPTY_VERBOSE_DETAIL);
    });

    it('stores the raw track and stationName separately (no fallback chaining in the parser)', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.message(VERBOSE_NOW_PLAYING_XML({track: 'Track title', stationName: 'Station name'}));

        expect(wsState.deviceNowPlaying).toBe('Track title');
        expect(wsState.deviceNowPlayingDetail).not.toBeNull();
        expect(wsState.deviceNowPlayingDetail!.stationName).toBe('Station name');
    });

    it('is never fatal on malformed verbose payloads and keeps parsing', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();

        // garbage art chardata — stored raw, never fatal
        expect(() => ws.message(VERBOSE_NOW_PLAYING_XML({art: '::not-a-url::'}))).not.toThrow();
        expect(wsState.deviceNowPlayingDetail).not.toBeNull();
        expect(wsState.deviceNowPlayingDetail!.art).toBe('::not-a-url::');
        expect(wsState.deviceNowPlaying).toBe('Track title');

        // a ContentItem without any attributes still parses
        expect(() => ws.message('<updates deviceID="689E19B8BB8A"><nowPlayingUpdated><nowPlaying source="RADIO_BROWSER"><track>T</track><ContentItem><itemName>Only item</itemName></ContentItem><playStatus>PLAY_STATE</playStatus></nowPlaying></nowPlayingUpdated></updates>')).not.toThrow();
        expect(wsState.deviceNowPlaying).toBe('T');
        expect(wsState.deviceNowPlayingDetail!.contentItem).toEqual({
            source: '',
            type: '',
            location: '',
            sourceAccount: '',
            itemName: 'Only item',
            containerArt: '',
        });
    });

    it('parses the verbose RESPONSE into the identical detail plus the header deviceID', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.message(VERBOSE_NOW_PLAYING_RESPONSE_XML());

        expect(wsState.deviceNowPlayingDetail).toEqual(FULL_VERBOSE_DETAIL);
        expect(wsState.deviceNowPlaying).toBe('Track title');
        expect(wsState.devicePlayStatus).toBe('PLAY_STATE');
        expect(wsState.soundtouchDevice).toEqual({ id: '689E19B8BB8A' });
    });
});

describe('device info — full payload parsing (FR-3 extension)', () => {
    it('parses every DeviceInfo field from a full info RESPONSE', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        // the <info> element's own deviceID attribute wins over the header's
        ws.message(FULL_INFO_RESPONSE_XML());

        expect(wsState.soundtouchDevice).toEqual({
            id: '689E19B8BB8A',
            name: 'Bose SoundTouch B9B8BC',
            type: 'SoundTouch 10',
            moduleType: 'soundtouch',
            variant: 'Variant XYZ',
            variantMode: 'normal',
            countryCode: 'DE',
            regionCode: 'EU',
            networkType: 'WIRED',
            ipAddress: '192.168.1.42',
            componentCategory: 'SoundTouch',
            softwareVersion: '3.8.8.2',
            margeUrl: 'https://marge.example.com',
            margeAccountUuid: 'uuid-1',
        });
    });

    it('stores only the present fields for a partial info RESPONSE', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.message('<msg><header deviceID="689E19B8BB8A" url="info" method="GET" msgType="RESPONSE"><request requestID="3"/></header><body><info deviceID="689E19B8BB8A"><name>Bose SoundTouch B9B8BC</name><moduleType>soundtouch</moduleType></info></body></msg>');

        expect(wsState.soundtouchDevice).toEqual({ id: '689E19B8BB8A', name: 'Bose SoundTouch B9B8BC', moduleType: 'soundtouch' });
        for (const absent of ['type', 'variant', 'variantMode', 'countryCode', 'regionCode', 'networkType', 'macAddress', 'ipAddress', 'componentCategory', 'serialNumber', 'softwareVersion', 'margeUrl', 'margeAccountUuid']) {
            expect(wsState.soundtouchDevice).not.toHaveProperty(absent);
        }
    });

    it('keeps the first component when an info payload carries several', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.message('<msg><header deviceID="689E19B8BB8A" url="info" method="GET" msgType="RESPONSE"><request requestID="3"/></header><body><info deviceID="689E19B8BB8A"><components><component><componentCategory>SoundTouch</componentCategory><softwareVersion>1.2.3</softwareVersion><serialNumber>SN-FIRST</serialNumber></component><component><componentCategory>Other</componentCategory><softwareVersion>9.9.9</softwareVersion><serialNumber>SN-SECOND</serialNumber></component></components></info></body></msg>');

        expect(wsState.soundtouchDevice).not.toBeNull();
        expect(wsState.soundtouchDevice!.softwareVersion).toBe('1.2.3');
        expect(wsState.soundtouchDevice!.componentCategory).toBe('SoundTouch');
    });

    it('takes the id from the info element when the header carries none', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.message('<msg><header url="info" method="GET" msgType="RESPONSE"><request requestID="3"/></header><body><info deviceID="689E19B8BB8A"><name>Bose SoundTouch B9B8BC</name></info></body></msg>');

        expect(wsState.soundtouchDevice).toEqual({ id: '689E19B8BB8A', name: 'Bose SoundTouch B9B8BC' });
    });

    it('stores { id: "" } when an info payload carries no deviceID and none is known', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.message('<msg><header url="info" method="GET" msgType="RESPONSE"><request requestID="3"/></header><body><info/></body></msg>');

        expect(wsState.soundtouchDevice).toEqual({ id: '' });
    });
});

describe('remote control panel', () => {
    it('renders the panel when an address is saved and hides it otherwise', () => {
        settingsView.settings.hideRemoteSkipButtons = false;
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

    it('disables the controls unless the connection is connected, gating next/prev on the skip flags', () => {
        wsState.wsStatus = 'connecting';
        settingsView.settings.hideRemoteSkipButtons = false;
        render();
        for (const id of ['#remotePlayPause', '#remoteNext', '#remotePrev', '#remoteMute']) {
            expect((document.querySelector(id) as HTMLButtonElement).disabled).toBe(true);
        }
        expect((document.querySelector('#remoteVolume') as HTMLInputElement).disabled).toBe(true);

        // connected without a verbose payload: next/prev stay disabled (presence gating)
        wsState.wsStatus = 'connected';
        wsState.deviceNowPlayingDetail = null;
        render();
        expect((document.querySelector('#remotePlayPause') as HTMLButtonElement).disabled).toBe(false);
        expect((document.querySelector('#remoteNext') as HTMLButtonElement).disabled).toBe(true);
        expect((document.querySelector('#remotePrev') as HTMLButtonElement).disabled).toBe(true);
        expect((document.querySelector('#remoteMute') as HTMLButtonElement).disabled).toBe(false);
        expect((document.querySelector('#remoteVolume') as HTMLInputElement).disabled).toBe(false);

        // skip flags present → all five enabled
        wsState.deviceNowPlayingDetail = detail({skipEnabled: true, skipPreviousEnabled: true});
        render();
        expect((document.querySelector('#remoteNext') as HTMLButtonElement).disabled).toBe(false);
        expect((document.querySelector('#remotePrev') as HTMLButtonElement).disabled).toBe(false);
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
        settingsView.settings.hideRemoteSkipButtons = false;
        const html = renderRemotePanel(state, getLabels(state));

        expect(html).toContain('id="remotePlayPause"');
        expect(html).toContain('id="remoteNext"');
        expect(html).toContain('id="remotePrev"');
        expect(html).toContain('id="remoteMute"');
        expect(html).toContain('id="remoteVolume"');
    });

    it('hides #remoteNext/#remotePrev by default — transport collapses to a single play/pause', () => {
        // default settings: hideRemoteSkipButtons is on → the remote renders
        // no skip buttons; play/pause, volume, and mute are never affected
        wsState.wsStatus = 'connected';
        render();
        expect(document.querySelector('#remoteNext')).toBeNull();
        expect(document.querySelector('#remotePrev')).toBeNull();
        expect(document.querySelector('#remotePlayPause')).not.toBeNull();
        expect(document.querySelector('#remoteMute')).not.toBeNull();
        expect(document.querySelector('#remoteVolume')).not.toBeNull();
        expect(document.querySelectorAll('.remote-transport .btn').length).toBe(1);
    });

    it('renderRemotePanel omits the skip buttons by default', () => {
        wsState.wsStatus = 'connected';
        wsState.devicePlayStatus = 'PLAY_STATE';
        const html = renderRemotePanel(state, getLabels(state));

        expect(html).toContain('id="remotePlayPause"');
        expect(html).toContain('id="remoteMute"');
        expect(html).toContain('id="remoteVolume"');
        expect(html).not.toContain('id="remoteNext"');
        expect(html).not.toContain('id="remotePrev"');
    });

    it('shows next/prev when hideRemoteSkipButtons is false, still gated on the skip flags', () => {
        settingsView.settings.hideRemoteSkipButtons = false;
        wsState.wsStatus = 'connected';
        // connected without the skip flags → present but disabled (presence gating)
        wsState.deviceNowPlayingDetail = detail();
        render();
        const next = document.querySelector('#remoteNext') as HTMLButtonElement;
        const prev = document.querySelector('#remotePrev') as HTMLButtonElement;
        expect(next).not.toBeNull();
        expect(prev).not.toBeNull();
        expect(next.disabled).toBe(true);
        expect(prev.disabled).toBe(true);
        // flags present → enabled
        wsState.deviceNowPlayingDetail = detail({skipEnabled: true, skipPreviousEnabled: true});
        render();
        expect((document.querySelector('#remoteNext') as HTMLButtonElement).disabled).toBe(false);
        expect((document.querySelector('#remotePrev') as HTMLButtonElement).disabled).toBe(false);
    });

    it('adds non-empty remote-control labels in all four languages', () => {
        const keys = ['remoteTitle', 'remoteConnected', 'remoteReconnecting', 'remotePlay', 'remotePause', 'remoteNext', 'remotePrev', 'remoteMute', 'remoteUnmute', 'remoteVolume', 'remotePlaying', 'remotePaused', 'remoteBuffering', 'remoteStopped'];
        for (const lang of ['en', 'de', 'ru', 'ukr'] as const) {
            for (const key of keys) {
                expect(tView[lang][key]?.trim()).toBeTruthy();
            }
        }
    });

    it('falls the title back track → stationName → itemName → noStationPlaying', () => {
        wsState.wsStatus = 'connected';
        const strong = () => document.querySelector('.remote-nowplaying strong')!.textContent;

        wsState.deviceNowPlaying = 'Track title';
        wsState.deviceNowPlayingDetail = detail({stationName: 'Station name', contentItem: contentItem({itemName: 'Item name'})});
        render();
        expect(strong()).toBe('Track title');

        wsState.deviceNowPlaying = '';
        wsState.deviceNowPlayingDetail = detail({stationName: 'Station name'});
        render();
        expect(strong()).toBe('Station name');

        wsState.deviceNowPlayingDetail = detail({stationName: '', contentItem: contentItem({itemName: 'Item name'})});
        render();
        expect(strong()).toBe('Item name');

        wsState.deviceNowPlayingDetail = null;
        render();
        expect(strong()).toBe(tView.en.noStationPlaying);
    });

    it('falls the artist back to the verbose description and keeps album/source in the meta line', () => {
        wsState.wsStatus = 'connected';
        wsState.deviceAlbum = 'Album name';
        wsState.deviceSource = 'RADIO_BROWSER';
        const small = () => document.querySelector('.remote-nowplaying small')!;

        // artist present → description ignored
        wsState.deviceArtist = 'Artist name';
        wsState.deviceNowPlayingDetail = detail({description: 'Station description'});
        render();
        expect(small().textContent).toBe('Artist name · Album name · RADIO_BROWSER');
        expect(small().textContent).not.toContain('Station description');

        // artist absent → description takes its slot
        wsState.deviceArtist = '';
        wsState.deviceNowPlayingDetail = detail({description: 'Station description'});
        render();
        expect(small().textContent).toBe('Station description · Album name · RADIO_BROWSER');

        // both absent → album/source join as today
        wsState.deviceNowPlayingDetail = detail({description: ''});
        render();
        expect(small().textContent).toBe('Album name · RADIO_BROWSER');
    });

    it.each<[string, string, DeviceNowPlayingVerbose | null, [boolean, boolean]]>([
        ['connected + flags present', 'connected', detail({skipEnabled: true, skipPreviousEnabled: true}), [false, false]],
        ['connected + flags absent', 'connected', detail(), [true, true]],
        ['reconnecting + flags present', 'reconnecting', detail({skipEnabled: true, skipPreviousEnabled: true}), [true, true]],
        ['connected + no detail', 'connected', null, [true, true]],
    ])('skip gating: %s', (_name, wsStatus, deviceNowPlayingDetail, expected) => {
        wsState.wsStatus = wsStatus;
        wsState.deviceNowPlayingDetail = deviceNowPlayingDetail;
        settingsView.settings.hideRemoteSkipButtons = false;
        render();
        expect((document.querySelector('#remoteNext') as HTMLButtonElement).disabled).toBe(expected[0]);
        expect((document.querySelector('#remotePrev') as HTMLButtonElement).disabled).toBe(expected[1]);
    });

    // FR-6 artwork slot contract: the Remote panel artwork renders through the
    // artwork module's slot (skeleton while the device art URL is unprimed,
    // img once ready, empty slot on failure) instead of the old inline-onerror
    // img. The contract is pinned black-box through render(): src/artwork.ts
    // does not exist until the FR-6 implementation wave, so any direct import
    // would fail this whole file at load time and take the passing tests down
    // with it — these three tests fail on the missing feature instead.
    describe('artwork — FR-6 slot contract', () => {
        beforeEach(() => {
            FakeImage.instances = [];
            vi.stubGlobal('Image', FakeImage);
            // the artwork registry and the per-station cache are module/global
            // state shared across the whole file — reset both so every slot
            // test starts from an unprimed registry (a settled URL or a cached
            // art key from an earlier test would render an img, not a skeleton)
            resetArtworkState();
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const key = localStorage.key(i);
                if (key?.startsWith('radio-browser-art-')) localStorage.removeItem(key);
            }
            // wave 11: the artwork slot is gated on the play status — every test in
            // this block asserts a rendered slot, so the device is playing
            wsState.devicePlayStatus = 'PLAY_STATE';
        });

        it('shows a skeleton artwork slot while the art URL is unprimed, then a single img.artwork-slot with escaped src, empty alt, and no inline onerror once ready', () => {
            wsState.wsStatus = 'connected';
            const artUrl = 'http://192.168.1.42:8090/v1/art.png?a=1&b=2';
            wsState.deviceNowPlayingDetail = detail({art: artUrl});
            render();

            // unprimed → skeleton placeholder carrying the URL for the background fetch
            const skeleton = document.querySelector('span.artwork-slot.artwork-skeleton');
            expect(skeleton).not.toBeNull();
            expect(skeleton!.getAttribute('data-art-url')).toBe(artUrl);
            expect(document.querySelector('img.artwork-slot')).toBeNull();

            // render()'s background scan requested the URL; settle the load
            expect(FakeImage.instances).toHaveLength(1);
            FakeImage.instances[0].onload?.();
            render();

            const imgs = document.querySelectorAll('img.artwork-slot');
            expect(imgs).toHaveLength(1);
            const img = imgs[0];
            expect(img.getAttribute('src')).toBe(artUrl);
            expect(img.getAttribute('alt')).toBe('');
            expect(img.hasAttribute('onerror')).toBe(false);
            // escaped in the raw HTML
            expect(document.querySelector('#app')!.innerHTML).toContain('a=1&amp;b=2');
        });

        it('prefers WS-emitted ContentItem.containerArt over the device art and the app-side favicon', () => {
            wsState.wsStatus = 'connected';
            const containerArtUrl = 'http://192.168.1.42:8090/v1/ws-chain-container-art.png';
            const artUrl = 'http://192.168.1.42:8090/v1/ws-chain-art.png';
            state.stations = [{ stationuuid: 'hl-uuid', name: 'Highlighted', favicon: 'http://cdn.example.com/hl-favicon.png' }];
            state.currentIndex = 0;
            wsState.deviceNowPlayingDetail = detail({ art: artUrl, contentItem: contentItem({ containerArt: containerArtUrl }) });
            render();

            // the WS-emitted containerArt URL is what gets fetched and rendered —
            // the highlighted station's favicon (the app-side fallback) loses to it
            const artImage = FakeImage.instances.find(img => img.src === containerArtUrl);
            expect(artImage).toBeDefined();
            artImage!.onload?.();
            render();

            const imgs = document.querySelectorAll('.remote-nowplaying img.artwork-slot');
            expect(imgs).toHaveLength(1);
            expect(imgs[0].getAttribute('src')).toBe(containerArtUrl);
        });

        it('renders the slot uuid from the echoed canonical /stations/byuuid/<uuid> location', () => {
            wsState.wsStatus = 'connected';
            const artUrl = 'http://192.168.1.42:8090/v1/echoed-location-art.png';
            wsState.deviceNowPlayingDetail = detail({
                art: artUrl,
                contentItem: contentItem({ location: '/stations/byuuid/echo-uuid' }),
            });
            state.stations = [{ stationuuid: 'hl-uuid', name: 'Highlighted' }];
            state.currentIndex = 0;
            render();

            const skeleton = document.querySelector('.remote-nowplaying span.artwork-slot.artwork-skeleton');
            expect(skeleton).not.toBeNull();
            // the echoed station's uuid keys the slot, never the highlighted one
            expect(skeleton!.getAttribute('data-art-url')).toBe(artUrl);
            expect(skeleton!.getAttribute('data-art-uuid')).toBe('echo-uuid');
        });

        it.each<string>([
            '/v1/play/1',
            '/stations/byuuid/',
            '/stations/byuuid/uuid-2/',
            '/stations/byuuid/uuid-3/extra',
            '',
        ])('falls back to the highlighted station uuid for the non-canonical echoed location %j', (location) => {
            wsState.wsStatus = 'connected';
            const artUrl = 'http://192.168.1.42:8090/v1/fallback-location-art.png';
            wsState.deviceNowPlayingDetail = detail({
                art: artUrl,
                contentItem: contentItem({ location }),
            });
            state.stations = [{ stationuuid: 'hl-uuid', name: 'Highlighted' }];
            state.currentIndex = 0;
            render();

            const skeleton = document.querySelector('.remote-nowplaying span.artwork-slot.artwork-skeleton');
            expect(skeleton).not.toBeNull();
            expect(skeleton!.getAttribute('data-art-uuid')).toBe('hl-uuid');
        });

        it('caches the WS-sourced logo under the echoed station uuid once the background fetch settles', () => {
            connectSoundtouchWs('192.168.1.42');
            const ws = FakeWebSocket.instances[0];
            ws.open();
            const logoUrl = 'http://192.168.1.42:8090/v1/ws-cache-echo-logo.png';
            state.stations = [{ stationuuid: 'hl-uuid', name: 'Highlighted' }];
            state.currentIndex = 0;
            ws.message(`<updates deviceID="689E19B8BB8A"><nowPlayingUpdated deviceID="689E19B8BB8A"><nowPlaying source="RADIO_BROWSER">
                <track>Echoed station</track>
                <ContentItem source="RADIO_BROWSER" type="STATION" location="/stations/byuuid/echo-uuid">
                    <itemName>Echoed station</itemName>
                    <containerArt>${logoUrl}</containerArt>
                </ContentItem>
                <playStatus>PLAY_STATE</playStatus>
            </nowPlaying></nowPlayingUpdated></updates>`);

            // the dispatch rendered the skeleton slot keyed by the echoed uuid
            const skeleton = document.querySelector('.remote-nowplaying span.artwork-slot.artwork-skeleton');
            expect(skeleton).not.toBeNull();
            expect(skeleton!.getAttribute('data-art-uuid')).toBe('echo-uuid');

            // the settle persists the WS-emitted logo under the echoed station's
            // uuid — never the highlighted station's
            const artImage = FakeImage.instances.find(img => img.src === logoUrl);
            expect(artImage).toBeDefined();
            artImage!.onload?.();
            expect(loadArtworkCache('echo-uuid')).toBe(logoUrl);
            expect(localStorage.getItem('radio-browser-art-echo-uuid')).toBe(JSON.stringify(logoUrl));
            expect(loadArtworkCache('hl-uuid')).toBeNull();
        });

        it('caches the WS-sourced logo under the highlighted station uuid when the echoed location is not canonical', () => {
            connectSoundtouchWs('192.168.1.42');
            const ws = FakeWebSocket.instances[0];
            ws.open();
            const fallbackUrl = 'http://192.168.1.42:8090/v1/ws-cache-fallback-logo.png';
            state.stations = [{ stationuuid: 'hl-uuid', name: 'Highlighted' }];
            state.currentIndex = 0;
            ws.message(`<updates deviceID="689E19B8BB8A"><nowPlayingUpdated deviceID="689E19B8BB8A"><nowPlaying source="RADIO_BROWSER">
                <track>Fallback station</track>
                <ContentItem source="RADIO_BROWSER" type="STATION" location="/v1/play/1">
                    <containerArt>${fallbackUrl}</containerArt>
                </ContentItem>
                <playStatus>PLAY_STATE</playStatus>
            </nowPlaying></nowPlayingUpdated></updates>`);

            const fallbackImage = FakeImage.instances.find(img => img.src === fallbackUrl);
            expect(fallbackImage).toBeDefined();
            fallbackImage!.onload?.();
            expect(loadArtworkCache('hl-uuid')).toBe(fallbackUrl);
            expect(loadArtworkCache('echo-uuid')).toBeNull();
        });

        it('writes no artwork cache entry (never an empty key) when neither the echoed location is canonical nor a station is highlighted', () => {
            connectSoundtouchWs('192.168.1.42');
            const ws = FakeWebSocket.instances[0];
            ws.open();
            const orphanUrl = 'http://192.168.1.42:8090/v1/ws-cache-orphan-logo.png';
            state.stations = [];
            state.currentIndex = -1;
            ws.message(`<updates deviceID="689E19B8BB8A"><nowPlayingUpdated deviceID="689E19B8BB8A"><nowPlaying source="RADIO_BROWSER">
                <track>Orphan station</track>
                <ContentItem source="RADIO_BROWSER" type="STATION" location="/v1/play/1">
                    <containerArt>${orphanUrl}</containerArt>
                </ContentItem>
                <playStatus>PLAY_STATE</playStatus>
            </nowPlaying></nowPlayingUpdated></updates>`);

            const orphanImage = FakeImage.instances.find(img => img.src === orphanUrl);
            expect(orphanImage).toBeDefined();
            orphanImage!.onload?.();
            // the settle with no slot uuid skips the cache write entirely — an
            // empty `radio-browser-art-` key is never created
            expect(localStorage.getItem('radio-browser-art-')).toBeNull();
            for (let i = 0; i < localStorage.length; i++) {
                expect(localStorage.key(i)).not.toMatch(/^radio-browser-art-/);
            }
        });

        it('renders no data-art-uuid when neither the echoed location is canonical nor a station is highlighted', () => {
            wsState.wsStatus = 'connected';
            const artUrl = 'http://192.168.1.42:8090/v1/no-uuid-art.png';
            wsState.deviceNowPlayingDetail = detail({
                art: artUrl,
                contentItem: contentItem({ location: '/v1/play/1' }),
            });
            state.stations = [];
            state.currentIndex = -1;
            render();

            const skeleton = document.querySelector('.remote-nowplaying span.artwork-slot.artwork-skeleton');
            expect(skeleton).not.toBeNull();
            expect(skeleton!.hasAttribute('data-art-uuid')).toBe(false);
        });

        it('renders no artwork when both art and containerArt are empty (never fatal), and an empty slot once the art URL fails', () => {
            wsState.wsStatus = 'connected';
            wsState.deviceNowPlayingDetail = detail({art: '', contentItem: contentItem({containerArt: ''})});

            expect(() => render()).not.toThrow();
            expect(document.querySelector('.artwork-slot')).toBeNull();
            expect(FakeImage.instances).toHaveLength(0);

            // a dead/blocked art URL degrades to the empty slot — never an img
            const artUrl = 'http://192.168.1.42:8090/v1/dead.png';
            wsState.deviceNowPlayingDetail = detail({art: artUrl});
            render();
            expect(FakeImage.instances).toHaveLength(1);
            FakeImage.instances[0].onerror?.();
            render();
            expect(document.querySelector('span.artwork-slot--empty')).not.toBeNull();
            expect(document.querySelector('img.artwork-slot')).toBeNull();
        });
    });

    // Wave 11 plays-only gate: the now-playing artwork slot renders only while
    // the device reports PLAY_STATE or BUFFERING_STATE — nothing for PAUSE,
    // STOP, or empty/unknown statuses, no matter what artwork URLs are known
    // (WS-emitted containerArt, device art, highlighted-station favicon).
    describe('artwork — plays-only gate (wave 11)', () => {
        beforeEach(() => {
            FakeImage.instances = [];
            vi.stubGlobal('Image', FakeImage);
            // reset the artwork registry and the per-station cache so every test
            // starts from an unprimed registry (a settled URL or a cached art key
            // from an earlier test would render an img, not a skeleton). The
            // file-level beforeEach leaves devicePlayStatus '' — each test sets
            // the status it exercises.
            resetArtworkState();
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const key = localStorage.key(i);
                if (key?.startsWith('radio-browser-art-')) localStorage.removeItem(key);
            }
        });

        it('renders the artwork slot while PLAY_STATE — skeleton then a single img.artwork-slot (gate open)', () => {
            wsState.wsStatus = 'connected';
            wsState.devicePlayStatus = 'PLAY_STATE';
            const artUrl = 'http://192.168.1.42:8090/v1/gate-open-art.png';
            wsState.deviceNowPlayingDetail = detail({art: artUrl});
            render();

            // gate open + unprimed → skeleton carrying the URL for the background fetch
            const skeleton = document.querySelector('span.artwork-slot.artwork-skeleton');
            expect(skeleton).not.toBeNull();
            expect(skeleton!.getAttribute('data-art-url')).toBe(artUrl);
            expect(document.querySelector('img.artwork-slot')).toBeNull();

            // render()'s background scan requested the URL; settle the load
            expect(FakeImage.instances).toHaveLength(1);
            FakeImage.instances[0].onload?.();
            render();

            const imgs = document.querySelectorAll('.remote-nowplaying img.artwork-slot');
            expect(imgs).toHaveLength(1);
            expect(imgs[0].getAttribute('src')).toBe(artUrl);
            expect(imgs[0].getAttribute('alt')).toBe('');
            expect(imgs[0].hasAttribute('onerror')).toBe(false);
        });

        it('renders the artwork slot while BUFFERING_STATE — skeleton then a single img.artwork-slot (gate open)', () => {
            wsState.wsStatus = 'connected';
            wsState.devicePlayStatus = 'BUFFERING_STATE';
            const artUrl = 'http://192.168.1.42:8090/v1/gate-open-buffering.png';
            wsState.deviceNowPlayingDetail = detail({art: artUrl});
            render();

            const skeleton = document.querySelector('span.artwork-slot.artwork-skeleton');
            expect(skeleton).not.toBeNull();
            expect(skeleton!.getAttribute('data-art-url')).toBe(artUrl);
            expect(document.querySelector('img.artwork-slot')).toBeNull();

            expect(FakeImage.instances).toHaveLength(1);
            FakeImage.instances[0].onload?.();
            render();

            const imgs = document.querySelectorAll('.remote-nowplaying img.artwork-slot');
            expect(imgs).toHaveLength(1);
            expect(imgs[0].getAttribute('src')).toBe(artUrl);
            expect(imgs[0].getAttribute('alt')).toBe('');
            expect(imgs[0].hasAttribute('onerror')).toBe(false);
        });

        it.each<string>(['PAUSE_STATE', 'STOP_STATE', ''])('renders no artwork slot for %j even with known containerArt, device art, and a highlighted station favicon (gate closed)', (playStatus) => {
            wsState.wsStatus = 'connected';
            wsState.devicePlayStatus = playStatus;
            state.stations = [{ stationuuid: 'hl-uuid', name: 'Highlighted', favicon: 'http://cdn.example.com/gate-closed-favicon.png' }];
            state.currentIndex = 0;
            wsState.deviceNowPlayingDetail = detail({
                art: 'http://192.168.1.42:8090/v1/gate-closed-art.png',
                contentItem: contentItem({ containerArt: 'http://192.168.1.42:8090/v1/gate-closed-container-art.png' }),
            });
            render();

            // gate closed ⇒ no slot at all, no skeleton ⇒ no background fetch
            expect(document.querySelector('.remote-nowplaying .artwork-slot')).toBeNull();
            expect(document.querySelector('img.artwork-slot')).toBeNull();
            expect(FakeImage.instances).toHaveLength(0);
        });

        it('keeps the title, meta line, and play-status chip when the logo is gated off', () => {
            wsState.wsStatus = 'connected';
            wsState.devicePlayStatus = 'PAUSE_STATE';
            wsState.deviceNowPlaying = 'Track title';
            wsState.deviceArtist = 'Artist name';
            wsState.deviceAlbum = 'Album name';
            wsState.deviceSource = 'RADIO_BROWSER';
            state.stations = [{ stationuuid: 'hl-uuid', name: 'Highlighted', favicon: 'http://cdn.example.com/gate-closed-favicon.png' }];
            state.currentIndex = 0;
            wsState.deviceNowPlayingDetail = detail({
                art: 'http://192.168.1.42:8090/v1/gate-closed-art.png',
                contentItem: contentItem({ containerArt: 'http://192.168.1.42:8090/v1/gate-closed-container-art.png' }),
            });
            render();

            expect(document.querySelector('.artwork-slot')).toBeNull();
            const strong = document.querySelector('.remote-nowplaying strong');
            expect(strong!.textContent).toBe('Track title');
            const small = document.querySelector('.remote-nowplaying small');
            expect(small!.textContent).toBe('Artist name · Album name · RADIO_BROWSER');
            expect(document.querySelector('.remote-playstatus')!.textContent).toBe(tView.en.remotePaused);
        });
    });

    it('populates the panel at connect time from the verbose now_playing RESPONSE', () => {
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.message(VERBOSE_NOW_PLAYING_RESPONSE_XML());

        expect(wsState.deviceNowPlayingDetail).not.toBeNull();
        const strong = document.querySelector('.remote-nowplaying strong');
        expect(strong!.textContent).toBe('Track title');
        expect(document.querySelector('.remote-playstatus')!.textContent).toBe(tView.en.remotePlaying);
        expect(document.querySelector('#app')!.textContent).not.toContain(tView.en.noStationPlaying);
    });

    it('renders the standby button in the header after the ℹ device-info widget with the localized label (wave 10)', () => {
        wsState.soundtouchDevice = { id: '689E19B8BB8A' };
        wsState.wsStatus = 'connected';
        render();

        const power = document.querySelector('#remotePower');
        expect(power).not.toBeNull();
        const head = document.querySelector('.remote-head');
        expect(head).not.toBeNull();
        expect(head!.contains(power)).toBe(true);
        // upper-right corner: the button is the header's last child, right
        // after the ℹ device-info widget
        const children = Array.from(head!.children);
        expect(children[children.length - 1]).toBe(power);
        expect(children[children.length - 2]!.classList.contains('soundtouch-info')).toBe(true);

        const btn = power as HTMLButtonElement;
        expect(btn.getAttribute('aria-label')).toBe(tView.en.remoteStandby);
        expect(btn.getAttribute('title')).toBe(tView.en.remoteStandby);
        const svg = btn.querySelector('svg');
        expect(svg).not.toBeNull();
        expect(svg!.getAttribute('viewBox')).toBe('0 0 24 24');
        expect(svg!.getAttribute('fill')).toBe('currentColor');
        expect(svg!.getAttribute('aria-hidden')).toBe('true');
        expect(svg!.getAttribute('focusable')).toBe('false');
    });

    it('disables the standby button unless the WebSocket is connected (wave 10)', () => {
        for (const status of ['idle', 'connecting', 'reconnecting']) {
            wsState.wsStatus = status;
            render();
            const btn = document.querySelector('#remotePower') as HTMLButtonElement;
            expect(btn).not.toBeNull();
            expect(btn!.disabled).toBe(true);
        }

        wsState.wsStatus = 'connected';
        render();
        const btn = document.querySelector('#remotePower') as HTMLButtonElement;
        expect(btn).not.toBeNull();
        expect(btn!.disabled).toBe(false);
    });

    it('keeps the standby button while the skip buttons are hidden (wave 10)', () => {
        // default settings: hideRemoteSkipButtons is on → next/prev are hidden,
        // the header standby button is a primary control and stays
        wsState.wsStatus = 'connected';
        render();
        expect(document.querySelector('#remotePower')).not.toBeNull();
        expect(document.querySelector('#remoteNext')).toBeNull();

        settingsView.settings.hideRemoteSkipButtons = false;
        render();
        expect(document.querySelector('#remotePower')).not.toBeNull();
        expect(document.querySelector('#remoteNext')).not.toBeNull();
    });

    it('renderRemotePanel includes the header standby button (wave 10)', () => {
        wsState.wsStatus = 'connected';
        const html = renderRemotePanel(state, getLabels(state));

        expect(html).toContain('id="remotePower"');
        expect(html).toContain(tView.en.remoteStandby);
    });

    it('hides the standby button together with the remote panel when no address is saved (wave 10)', () => {
        state.soundtouchAddress = '';
        state.skippedSetup = true;
        render();

        expect(document.querySelector('#remotePower')).toBeNull();
        expect(document.querySelector('.remote-panel')).toBeNull();
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
        // skip flags present → Next/Prev are enabled and the handler sends
        wsState.deviceNowPlayingDetail = detail({skipEnabled: true, skipPreviousEnabled: true});
        settingsView.settings.hideRemoteSkipButtons = false;
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
        wsState.deviceNowPlayingDetail = detail({skipEnabled: true, skipPreviousEnabled: true});
        settingsView.settings.hideRemoteSkipButtons = false;
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
        settingsView.settings.hideRemoteSkipButtons = false;
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

    it('sends nothing for next/prev while the skip flags are absent (presence gating in the handler)', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        wsState.wsStatus = 'connected';
        wsState.deviceNowPlayingDetail = detail(); // skipEnabled/skipPreviousEnabled false
        settingsView.settings.hideRemoteSkipButtons = false;
        render();
        setupEvents();

        // dispatchEvent bypasses the disabled attribute — the delegated handler
        // itself must guard on the presence flags.
        document.querySelector('#remoteNext')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        document.querySelector('#remotePrev')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await flush();

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends NEXT_TRACK/PREV_TRACK press+release when the skip flags are present', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        wsState.wsStatus = 'connected';
        wsState.deviceNowPlayingDetail = detail({skipEnabled: true, skipPreviousEnabled: true});
        settingsView.settings.hideRemoteSkipButtons = false;
        render();
        setupEvents();

        document.querySelector('#remoteNext')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(String(fetchMock.mock.calls[0][1].body)).toBe('<key state="press" sender="Gabbo">NEXT_TRACK</key>');
        expect(String(fetchMock.mock.calls[1][1].body)).toBe('<key state="release" sender="Gabbo">NEXT_TRACK</key>');

        document.querySelector('#remotePrev')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
        expect(String(fetchMock.mock.calls[2][1].body)).toBe('<key state="press" sender="Gabbo">PREV_TRACK</key>');
        expect(String(fetchMock.mock.calls[3][1].body)).toBe('<key state="release" sender="Gabbo">PREV_TRACK</key>');
    });

    it('sends POWER press+release when the standby button is clicked (wave 10)', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        wsState.wsStatus = 'connected';
        wsState.devicePlayStatus = 'PLAY_STATE';
        wsState.deviceVolume = 42;
        wsState.deviceMute = false;
        render();
        setupEvents();

        const power = document.querySelector('#remotePower');
        expect(power).not.toBeNull();
        (power as HTMLButtonElement).click();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

        const press = fetchMock.mock.calls[0] as [string, RequestInit];
        const release = fetchMock.mock.calls[1] as [string, RequestInit];
        for (const [url, init] of [press, release]) {
            expect(url).toBe('http://192.168.1.42:8090/key');
            expect(init.method).toBe('POST');
            expect(init.mode).toBe('no-cors');
            expect(new Headers(init.headers as HeadersInit).get('Content-Type')).toBe('text/plain;charset=UTF-8');
        }
        expect(String(press[1].body)).toBe('<key state="press" sender="Gabbo">POWER</key>');
        expect(String(release[1].body)).toBe('<key state="release" sender="Gabbo">POWER</key>');
        // no echo loop: the command POSTs never write live device state
        expect(wsState.devicePlayStatus).toBe('PLAY_STATE');
        expect(wsState.deviceVolume).toBe(42);
        expect(wsState.deviceMute).toBe(false);
    });

    it('sends POWER when the click target is the inner svg or path of #remotePower (wave 10)', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        wsState.wsStatus = 'connected';
        render();
        setupEvents();

        const svg = document.querySelector('#remotePower svg');
        expect(svg).not.toBeNull();
        svg!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(String(fetchMock.mock.calls[0][1].body)).toBe('<key state="press" sender="Gabbo">POWER</key>');
        expect(String(fetchMock.mock.calls[1][1].body)).toBe('<key state="release" sender="Gabbo">POWER</key>');

        const path = document.querySelector('#remotePower path');
        expect(path).not.toBeNull();
        path!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
        expect(String(fetchMock.mock.calls[2][1].body)).toBe('<key state="press" sender="Gabbo">POWER</key>');
        expect(String(fetchMock.mock.calls[3][1].body)).toBe('<key state="release" sender="Gabbo">POWER</key>');
    });

    it('ignores the standby button while reconnecting (zero POSTs) (wave 10)', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        wsState.wsStatus = 'reconnecting';
        render();
        setupEvents();

        // dispatchEvent bypasses the disabled attribute — the delegated
        // handler itself must guard on the connection state.
        const power = document.querySelector('#remotePower');
        expect(power).not.toBeNull();
        power!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await flush();

        expect(fetchMock).not.toHaveBeenCalled();
    });
});
