import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, state } from '../src/app';
import { setupEvents } from '../src/events';
// Wave 12: Settings gains enableSpeakerControl (default off — install-clean).
// Until src/state.ts + src/settings.ts change, ALL model reads/writes go
// through this typed view so the file stays type-clean at every commit.
import { defaultSettings, loadSettings, saveSettings } from '../src/settings';
import { checkSoundtouchOnStartup, connectSoundtouchWs } from '../src/soundtouch-ws';
import * as actionsModule from '../src/actions';
import { armSendConfirmation } from '../src/confirmation';
import { getLabels, translations } from '../src/i18n';
import {
    getArtworkLoadState,
    renderArtworkSlot,
    requestArtwork,
    resetArtworkState,
    saveArtworkCache,
    scanArtwork,
} from '../src/artwork';
import { renderRemotePanel } from '../src/components/remote';
import { getAudioElement } from '../src/player';
import type { State, Station } from '../src/state';

// Wave 12 i18n keys land with the implementation wave; until then the
// dictionary is accessed through this typed view.
const tView = translations as unknown as Record<string, Record<string, string>>;

// The toggle-off teardown must cancel a pending debounced volume send via the
// new cancelVolumeSend export (expected next to scheduleVolumeSend in
// src/actions.ts — the debounce state lives there). The namespace cast keeps
// this file type-clean before the export exists; the behavioral tests drive
// the cancellation through the UI path.
const actionsApi = actionsModule as unknown as { cancelVolumeSend?: () => void };

const LS_LANGUAGE = 'radio-browser-language';
const LS_SOUNDTOUCH = 'radio-browser-soundtouch-host';
const LS_FAVORITES = 'radio-browser-favorites';
const LS_SETTINGS = 'radio-browser-settings';

// Typed view over the wave-12 settings shape (mirrors app/soundtouch-ws/artwork shells).
const settingsView = state as unknown as {
    settings: { enablePreview: boolean; hideRemoteSkipButtons: boolean; enableSpeakerControl: boolean };
};

const HTTP_ART = 'http://cdn.example.com/art.png';
const HTTPS_ART = 'https://cdn.example.com/art.png';

const STATION: Station = {
    stationuuid: 'uuid-wave12',
    name: 'Wave 12 FM',
    favicon: HTTP_ART,
};

// jsdom has no WebSocket. The module must resolve `WebSocket` at construction
// time (plain global lookup) for this stub to be seen (same pattern as
// tests/soundtouch-ws.test.ts).
class FakeWebSocket {
    static instances: FakeWebSocket[] = [];
    url: string;
    protocols: string | string[];
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;
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
}

// jsdom never fires Image load/error events; the artwork module must resolve
// `Image` at request time (same pattern as tests/artwork.test.ts).
class FakeImage {
    static instances: FakeImage[] = [];
    src = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor() {
        FakeImage.instances.push(this);
    }
}

// Lets async probe callbacks settle under fake timers (same as soundtouch-ws tests).
const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
};

const NOW_PLAYING_XML = (track: string, playStatus: string) =>
    `<updates deviceID="689E19B8BB8A"><nowPlayingUpdated><nowPlaying source="RADIO_BROWSER"><track>${track}</track><artist>Artist name</artist><album>Album name</album><playStatus>${playStatus}</playStatus></nowPlaying></nowPlayingUpdated></updates>`;

const VOLUME_XML = (volume: number, mute: boolean) =>
    `<updates deviceID="689E19B8BB8A"><volumeUpdated><volume><targetvolume>${volume}</targetvolume><actualvolume>${volume}</actualvolume><muteenabled>${mute}</muteenabled></volume></volumeUpdated></updates>`;

/** Verbose-detail fixture typed straight off State (the full payload shape already exists). */
const detail = (overrides: Partial<NonNullable<State['deviceNowPlayingDetail']>> = {}): NonNullable<State['deviceNowPlayingDetail']> => ({
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
    ...overrides,
});

const stubFetchOk = (): ReturnType<typeof vi.fn> => {
    const fetchMock = vi.fn().mockResolvedValue({} as Response);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
};

const openPopup = () => {
    document.querySelector<HTMLButtonElement>('#openSettings')!.click();
};

/** Flips the speaker-control checkbox through the delegated change handler —
 * the same user path the popup uses. Fails cleanly while the third row does
 * not exist yet (missing feature), never with a TypeError. */
const flipSpeakerControl = (on: boolean) => {
    const cb = document.querySelector<HTMLInputElement>('#settingEnableSpeakerControl');
    expect(cb).not.toBeNull();
    cb!.checked = on;
    cb!.dispatchEvent(new Event('change', { bubbles: true }));
};

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    document.documentElement.lang = 'en';
    state.language = 'en';
    state.showSettings = false;
    state.skippedSetup = false;
    state.deviceMessage = '';
    // REQUIRED: without an address App() renders the setup view and shell
    // assertions fail (AGENTS.md testing notes).
    state.soundtouchAddress = '192.168.1.42';
    state.soundtouchStatus = 'available';
    // Wave 12 default for THIS suite: browse-only (toggle OFF). Tests that
    // exercise enabled-mode behavior opt in explicitly.
    settingsView.settings = { ...defaultSettings, enableSpeakerControl: false };
    state.stations = [];
    state.favorites = [];
    state.mode = 'top';
    state.offset = 0;
    state.currentIndex = -1;
    state.wsStatus = 'idle';
    state.deviceNowPlaying = '';
    state.deviceArtist = '';
    state.deviceAlbum = '';
    state.deviceSource = '';
    state.devicePlayStatus = '';
    state.deviceVolume = 0;
    state.deviceMute = false;
    state.deviceNowPlayingDetail = null;
    state.soundtouchDevice = null;
    for (const key of [LS_LANGUAGE, LS_SOUNDTOUCH, LS_FAVORITES, LS_SETTINGS]) {
        localStorage.removeItem(key);
    }
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith('radio-browser-art-')) localStorage.removeItem(key);
    }
    resetArtworkState();
    getAudioElement().removeAttribute('src');
    FakeWebSocket.instances = [];
    FakeImage.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('Image', FakeImage);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('settings model & migration (decisions 1–2)', () => {
    it('defaults gain enableSpeakerControl:false — install-clean out of the box', () => {
        expect(defaultSettings).toEqual({ enablePreview: false, hideRemoteSkipButtons: true, enableSpeakerControl: false });
    });

    it('present stored JSON without the key + a saved host migrates to on', () => {
        localStorage.setItem(LS_SOUNDTOUCH, '192.168.1.42');
        localStorage.setItem(LS_SETTINGS, JSON.stringify({ enablePreview: true, hideRemoteSkipButtons: false }));
        expect(loadSettings()).toEqual({ enablePreview: true, hideRemoteSkipButtons: false, enableSpeakerControl: true });
    });

    it('a wholly missing settings entry + a saved host migrates to on (the common pre-wave-12 state)', () => {
        localStorage.setItem(LS_SOUNDTOUCH, '192.168.1.42');
        expect(loadSettings()).toEqual({ enablePreview: false, hideRemoteSkipButtons: true, enableSpeakerControl: true });
    });

    it.each<[string, string | null]>([
        ['an empty saved host', ''],
        ['no host key at all', null],
    ])('absent key + %s stays off', (_label, host) => {
        if (host !== null) localStorage.setItem(LS_SOUNDTOUCH, host);
        expect(loadSettings()).toEqual({ enablePreview: false, hideRemoteSkipButtons: true, enableSpeakerControl: false });
    });

    it('corrupt JSON falls back to defaults (off) even with a saved host', () => {
        localStorage.setItem(LS_SOUNDTOUCH, '192.168.1.42');
        localStorage.setItem(LS_SETTINGS, '{corrupt');
        expect(loadSettings()).toEqual({ enablePreview: false, hideRemoteSkipButtons: true, enableSpeakerControl: false });
    });

    it.each<[string, unknown]>([
        ['string "yes"', 'yes'],
        ['numeric 1', 1],
    ])('a non-boolean stored value (%s) falls back contextually like an absent key', (_label, value) => {
        // context suggests ON…
        localStorage.setItem(LS_SOUNDTOUCH, '192.168.1.42');
        localStorage.setItem(LS_SETTINGS, JSON.stringify({ enableSpeakerControl: value }));
        expect(loadSettings()).toEqual({ enablePreview: false, hideRemoteSkipButtons: true, enableSpeakerControl: true });

        // …and without a host it falls back OFF
        localStorage.removeItem(LS_SOUNDTOUCH);
        expect(loadSettings()).toEqual({ enablePreview: false, hideRemoteSkipButtons: true, enableSpeakerControl: false });
    });

    it.each<boolean>([true, false])('once the key exists as a boolean its value always wins (%s)', (stored) => {
        localStorage.setItem(LS_SOUNDTOUCH, '192.168.1.42'); // context would suggest on
        localStorage.setItem(LS_SETTINGS, JSON.stringify({ enablePreview: true, enableSpeakerControl: stored }));
        expect(loadSettings()).toEqual({ enablePreview: true, hideRemoteSkipButtons: true, enableSpeakerControl: stored });

        localStorage.removeItem(LS_SOUNDTOUCH); // context would suggest off
        expect(loadSettings()).toEqual({ enablePreview: true, hideRemoteSkipButtons: true, enableSpeakerControl: stored });
    });

    it('saveSettings round-trips the third boolean verbatim (neutral host context)', () => {
        localStorage.setItem(LS_SOUNDTOUCH, '');
        const payload = { enablePreview: true, hideRemoteSkipButtons: false, enableSpeakerControl: true };
        saveSettings(payload);
        expect(loadSettings()).toEqual(payload);
    });
});

describe('browse-only while off — zero LAN traffic & suppressed UI (decision 3)', () => {
    it('loading the app while off initiates no fetch toward the device and constructs no WebSocket', async () => {
        const fetchMock = stubFetchOk();
        render();
        setupEvents();
        await flush();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it('while off, an unreachable device renders neither banner nor Remote panel', () => {
        state.soundtouchStatus = 'unreachable';
        state.stations = [STATION];
        render();
        expect(document.querySelector('.offline-banner')).toBeNull();
        expect(document.querySelector('.remote-panel')).toBeNull();
    });

    it('while off, Play-on-speaker renders disabled with the localized off-hint (device available)', () => {
        state.stations = [STATION];
        render();
        const playBtn = document.querySelector<HTMLButtonElement>('[data-play]');
        expect(playBtn).not.toBeNull();
        expect(playBtn!.disabled).toBe(true);
        expect(playBtn!.getAttribute('title')).toBe(getLabels(state).speakerControlOffHint);
    });

    it('while off, Play-on-speaker shows the off-hint (not the offline hint) even when unreachable', () => {
        state.soundtouchStatus = 'unreachable';
        state.stations = [STATION];
        render();
        const playBtn = document.querySelector<HTMLButtonElement>('[data-play]');
        expect(playBtn).not.toBeNull();
        expect(playBtn!.disabled).toBe(true);
        expect(playBtn!.getAttribute('title')).toBe(getLabels(state).speakerControlOffHint);
    });

    it('a dispatched [data-play] click while off sends nothing (handler-level gate)', async () => {
        const fetchMock = stubFetchOk();
        state.stations = [STATION];
        render();
        setupEvents();

        const playBtn = document.querySelector<HTMLButtonElement>('[data-play]');
        expect(playBtn).not.toBeNull();
        playBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await flush();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it('a dispatched #remotePlayPause click while off sends nothing (planted node simulates a DOM bypass)', async () => {
        const fetchMock = stubFetchOk();
        render();
        setupEvents();
        // While off the Remote panel is absent — plant stale/bypassed control
        // nodes into #app exactly like a leftover DOM would carry them; the
        // delegated handler itself must refuse.
        document.querySelector('#app')!.insertAdjacentHTML('beforeend', '<button id="remotePlayPause"></button>');
        state.wsStatus = 'connected'; // bypass the connection-state guard too

        document.getElementById('remotePlayPause')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await flush();

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a dispatched #remoteVolume change while off sends nothing, not even after the debounce window', async () => {
        vi.useFakeTimers();
        const fetchMock = stubFetchOk();
        render();
        setupEvents();
        document.querySelector('#app')!.insertAdjacentHTML('beforeend', '<input type="range" id="remoteVolume" value="66">');
        state.wsStatus = 'connected'; // bypass the connection-state guard too

        const slider = document.getElementById('remoteVolume') as HTMLInputElement;
        slider.value = '77';
        slider.dispatchEvent(new Event('change', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(400);

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('gate-at-call-site proof: direct checkSoundtouchOnStartup() invocations keep working while off', async () => {
        vi.useFakeTimers();
        const fetchMock = stubFetchOk();

        checkSoundtouchOnStartup('192.168.1.42');

        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(FakeWebSocket.instances[0].url).toBe('ws://192.168.1.42:8080/');
        FakeWebSocket.instances[0].open();
        expect(FakeWebSocket.instances[0].sent).toHaveLength(3); // snapshot on open
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0][0])).toBe('http://192.168.1.42:8090/info');
    });
});

describe('save implies on (decision 5)', () => {
    it('saving a non-empty host from the popup sets the flag, persists it, and runs today\'s sequence verbatim', async () => {
        vi.useFakeTimers();
        const fetchMock = stubFetchOk();
        state.soundtouchAddress = '';
        state.skippedSetup = true;
        render();
        setupEvents();
        openPopup();
        const input = document.querySelector<HTMLInputElement>('#settingSoundtouchHost');
        expect(input).not.toBeNull();
        input!.value = 'http://192.168.1.42/';
        document.querySelector<HTMLButtonElement>('#settingSoundtouchSave')!.click();

        // save implies on: flag + persistence
        expect(settingsView.settings.enableSpeakerControl).toBe(true);
        expect(JSON.parse(localStorage.getItem(LS_SETTINGS)!)).toEqual({
            enablePreview: false,
            hideRemoteSkipButtons: true,
            enableSpeakerControl: true,
        });

        // unchanged sequence: probe fetch → WS construct → snapshot on open
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0][0])).toBe('http://192.168.1.42:8090/info');
        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(FakeWebSocket.instances[0].url).toBe('ws://192.168.1.42:8080/');
        FakeWebSocket.instances[0].open();
        expect(FakeWebSocket.instances[0].sent).toHaveLength(3);
        await flush(); // the probe settles → status available, snapshot re-request
        expect(state.soundtouchStatus).toBe('available');
        expect(settingsView.settings.enableSpeakerControl).toBe(true);
    });

    it('saving a non-empty host from the first-run setup view implies on too', async () => {
        vi.useFakeTimers();
        stubFetchOk();
        state.soundtouchAddress = '';
        state.skippedSetup = false;
        render();
        expect(document.querySelector('.setup-view')).not.toBeNull();
        setupEvents();

        const input = document.querySelector<HTMLInputElement>('#soundtouch');
        expect(input).not.toBeNull();
        input!.value = '192.168.1.55';
        document.querySelector<HTMLButtonElement>('#saveSoundtouch')!.click();

        expect(settingsView.settings.enableSpeakerControl).toBe(true);
        expect(JSON.parse(localStorage.getItem(LS_SETTINGS)!).enableSpeakerControl).toBe(true);
        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(FakeWebSocket.instances[0].url).toBe('ws://192.168.1.55:8080/');
    });

    it('an empty save leaves the flag value untouched (manually on stays on)', () => {
        settingsView.settings.enableSpeakerControl = true;
        saveSettings(settingsView.settings);
        const before = localStorage.getItem(LS_SETTINGS);
        state.skippedSetup = true;
        render();
        setupEvents();
        openPopup();
        const input = document.querySelector<HTMLInputElement>('#settingSoundtouchHost');
        expect(input).not.toBeNull();
        input!.value = '';
        document.querySelector<HTMLButtonElement>('#settingSoundtouchSave')!.click();

        expect(state.soundtouchAddress).toBe('');
        expect(settingsView.settings.enableSpeakerControl).toBe(true);
        expect(localStorage.getItem(LS_SETTINGS)).toBe(before);
    });

    it('an empty save leaves a manually-off flag off and connects nothing', () => {
        stubFetchOk();
        state.skippedSetup = true;
        render();
        setupEvents();
        openPopup();
        const input = document.querySelector<HTMLInputElement>('#settingSoundtouchHost');
        expect(input).not.toBeNull();
        input!.value = '';
        document.querySelector<HTMLButtonElement>('#settingSoundtouchSave')!.click();

        expect(settingsView.settings.enableSpeakerControl).toBe(false);
        expect(JSON.parse(localStorage.getItem(LS_SETTINGS)!).enableSpeakerControl).toBe(false);
        expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it('a manually-off toggle stays off across unrelated renders until the next save or manual on', () => {
        settingsView.settings.enableSpeakerControl = true;
        state.stations = [STATION];
        render();
        setupEvents();
        openPopup();
        flipSpeakerControl(false);

        expect(settingsView.settings.enableSpeakerControl).toBe(false);
        expect(JSON.parse(localStorage.getItem(LS_SETTINGS)!).enableSpeakerControl).toBe(false);

        render(); // background render (device state, artwork settle) keeps it off
        expect(settingsView.settings.enableSpeakerControl).toBe(false);
        expect(document.querySelector('.remote-panel')).toBeNull();
    });
});

describe('toggle-off teardown mid-session (decision 6)', () => {
    it('flipping off tears down like a cleared host minus forgetting data', async () => {
        vi.useFakeTimers();
        const fetchMock = stubFetchOk();

        // live session: connected socket, mirrored device state, armed pending
        // send confirmation, scheduled debounced volume send
        settingsView.settings.enableSpeakerControl = true;
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.message(NOW_PLAYING_XML('Station name', 'PLAY_STATE'));
        ws.message(VOLUME_XML(50, false));
        armSendConfirmation(
            { stationName: 'Station name', location: '/stations/byuuid/uuid-wave12', wasRadioBrowserPlaying: false },
            getLabels(state),
            'Bose SoundTouch'
        );
        state.stations = [STATION];
        render();
        setupEvents();
        expect(document.querySelector('.remote-panel')).not.toBeNull();
        expect(state.deviceMessage).not.toBe('');

        openPopup();
        flipSpeakerControl(false);

        // pending send confirmation cancelled
        expect(state.deviceMessage).toBe('');
        // both device statuses forced to idle
        expect(state.soundtouchStatus).toBe('idle');
        expect(state.wsStatus).toBe('idle');
        // socket closed, reconnect timer cleared — advancing timers fires nothing
        expect(ws.closed).toBe(true);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(FakeWebSocket.instances).toHaveLength(1); // no reconnect storm
        expect(fetchMock).not.toHaveBeenCalled(); // debounced volume send cancelled too
        // live device state cleared
        expect(state.deviceNowPlaying).toBe('');
        expect(state.deviceArtist).toBe('');
        expect(state.deviceAlbum).toBe('');
        expect(state.deviceSource).toBe('');
        expect(state.devicePlayStatus).toBe('');
        expect(state.deviceVolume).toBe(0);
        expect(state.deviceMute).toBe(false);
        expect(state.deviceNowPlayingDetail).toBeNull();
        expect(state.soundtouchDevice).toBeNull();
        // Remote panel removed, banner absent
        expect(document.querySelector('.remote-panel')).toBeNull();
        expect(document.querySelector('.offline-banner')).toBeNull();
        // the choice persists
        expect(JSON.parse(localStorage.getItem(LS_SETTINGS)!).enableSpeakerControl).toBe(false);
    });

    it('the teardown cancels a pending debounced volume send (no /volume POST after the debounce window)', async () => {
        vi.useFakeTimers();
        const fetchMock = stubFetchOk();
        settingsView.settings.enableSpeakerControl = true;
        render();
        setupEvents();

        const { scheduleVolumeSend } = await import('../src/actions');
        scheduleVolumeSend(66);
        openPopup();
        flipSpeakerControl(false);
        await vi.advanceTimersByTimeAsync(400);

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('exposes the new cancelVolumeSend export alongside scheduleVolumeSend', async () => {
        const actions = await import('../src/actions');
        expect(typeof (actions as { cancelVolumeSend?: unknown }).cancelVolumeSend).toBe('function');
    });

    it('rapid double-flip keeps exactly one live socket', () => {
        stubFetchOk();
        settingsView.settings.enableSpeakerControl = true;
        connectSoundtouchWs('192.168.1.42');
        const first = FakeWebSocket.instances[0];
        first.open();
        render();
        setupEvents();
        openPopup();
        flipSpeakerControl(false);
        flipSpeakerControl(true);

        expect(first.closed).toBe(true);
        expect(FakeWebSocket.instances).toHaveLength(2);
        expect(FakeWebSocket.instances[1].closed).toBe(false);
        expect(state.wsStatus).toBe('connecting');
    });
});

describe('toggle on mid-session (decision 7)', () => {
    it('toggling on with a saved address runs the saved-address startup sequence immediately', async () => {
        vi.useFakeTimers();
        const fetchMock = stubFetchOk();
        render();
        setupEvents();
        expect(FakeWebSocket.instances).toHaveLength(0);

        openPopup();
        flipSpeakerControl(true);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0][0])).toBe('http://192.168.1.42:8090/info');
        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(FakeWebSocket.instances[0].url).toBe('ws://192.168.1.42:8080/');
        FakeWebSocket.instances[0].open();
        expect(FakeWebSocket.instances[0].sent).toHaveLength(3);
        await flush();
        expect(state.soundtouchStatus).toBe('available');
    });

    it('toggling on rescans skipped plain-HTTP artwork in place (no reload)', () => {
        state.stations = [STATION];
        render();
        setupEvents();
        expect(FakeImage.instances).toHaveLength(0); // refused while off

        openPopup();
        flipSpeakerControl(true);

        expect(FakeImage.instances.some((img) => img.src === HTTP_ART)).toBe(true);
    });
});

describe('reset semantics (decision 8)', () => {
    it('reset stores the literal default and tears down an active session; language and host untouched', () => {
        stubFetchOk();
        settingsView.settings.enableSpeakerControl = true;
        state.language = 'de';
        localStorage.setItem(LS_LANGUAGE, 'de');
        localStorage.setItem(LS_SOUNDTOUCH, '192.168.1.42');
        connectSoundtouchWs('192.168.1.42');
        FakeWebSocket.instances[0].open();
        state.stations = [STATION];
        render();
        setupEvents();
        openPopup();

        document.querySelector<HTMLButtonElement>('#resetSettings')!.click();

        expect(settingsView.settings).toEqual({
            enablePreview: false,
            hideRemoteSkipButtons: true,
            enableSpeakerControl: false,
        });
        expect(JSON.parse(localStorage.getItem(LS_SETTINGS)!)).toEqual({
            enablePreview: false,
            hideRemoteSkipButtons: true,
            enableSpeakerControl: false,
        });
        // teardown ran (on → off)
        expect(FakeWebSocket.instances[0].closed).toBe(true);
        expect(state.wsStatus).toBe('idle');
        expect(state.soundtouchStatus).toBe('idle');
        expect(document.querySelector('.remote-panel')).toBeNull();
        // language + host remain untouched per the established rules
        expect(state.language).toBe('de');
        expect(localStorage.getItem(LS_LANGUAGE)).toBe('de');
        expect(state.soundtouchAddress).toBe('192.168.1.42');
        expect(localStorage.getItem(LS_SOUNDTOUCH)).toBe('192.168.1.42');
    });
});

describe('quiet artwork while off (decision 9)', () => {
    it('renderArtworkSlot resolves an http URL straight to the empty slot — never a hanging skeleton', () => {
        const html = renderArtworkSlot(HTTP_ART, 'uuid-a');
        expect(html).toContain('artwork-slot--empty');
        expect(html).not.toContain('artwork-skeleton');
        expect(html).not.toContain('<img');
    });

    it('requestArtwork silently refuses http URLs while off (zero Image constructions)', () => {
        requestArtwork(HTTP_ART);
        expect(FakeImage.instances).toHaveLength(0);
    });

    it('scanArtwork silently refuses planted http slots while off (zero Image constructions)', () => {
        // a https slot requests normally…
        document.querySelector('#app')!.innerHTML = renderArtworkSlot(HTTPS_ART, 'uuid-c');
        // …while a planted http slot (e.g. rendered earlier while on) stays untouched
        document.querySelector('#app')!.insertAdjacentHTML(
            'beforeend',
            `<span class="artwork-slot artwork-skeleton" data-art-url="${HTTP_ART}" data-art-uuid="uuid-d" role="img" aria-hidden="true"></span>`
        );

        scanArtwork();

        expect(FakeImage.instances).toHaveLength(1);
        expect(FakeImage.instances[0].src).toBe(HTTPS_ART);
    });

    it('https URLs are unaffected while off', () => {
        requestArtwork(HTTPS_ART);
        expect(FakeImage.instances).toHaveLength(1);
        expect(FakeImage.instances[0].src).toBe(HTTPS_ART);
        expect(renderArtworkSlot(HTTPS_ART, 'uuid-b')).toContain(`data-art-url="${HTTPS_ART}"`);
    });

    it('an already-rendered ready logo stays visible across the flip to off; unknown http URLs stay gated', () => {
        settingsView.settings.enableSpeakerControl = true;
        requestArtwork(HTTP_ART);
        FakeImage.instances[0].onload?.();
        expect(renderArtworkSlot(HTTP_ART)).toContain('<img');

        state.stations = [STATION];
        render();
        setupEvents();
        openPopup();
        flipSpeakerControl(false);

        expect(getArtworkLoadState(HTTP_ART)).toBe('ready');
        expect(renderArtworkSlot(HTTP_ART)).toContain('<img'); // already-rendered logo survives
        expect(renderArtworkSlot('http://cdn.example.com/other.png')).toContain('artwork-slot--empty');
    });

    it('device-echoed http containerArt is gated at render in the Remote panel too', () => {
        state.devicePlayStatus = 'PLAY_STATE';
        state.deviceNowPlayingDetail = detail({
            stationName: 'Echo FM',
            contentItem: {
                source: 'RADIO_BROWSER',
                type: 'STATION',
                location: '/stations/byuuid/uuid-wave12',
                sourceAccount: '',
                itemName: 'Echo FM',
                containerArt: HTTP_ART,
            },
        });

        const offHtml = renderRemotePanel(state, getLabels(state));
        expect(offHtml).not.toContain('data-art-url');
        expect(offHtml).not.toContain('<img');

        settingsView.settings.enableSpeakerControl = true;
        const onHtml = renderRemotePanel(state, getLabels(state));
        expect(onHtml).toContain(`data-art-url="${HTTP_ART}"`);
    });

    it('a cached http fallback URL is ignored at read time while off and usable again after on', () => {
        saveArtworkCache('uuid-wave12', HTTP_ART);
        state.stations = [{ stationuuid: 'uuid-wave12', name: 'No-favicon FM' }];
        state.currentIndex = 0;
        state.devicePlayStatus = 'PLAY_STATE'; // wave-11 plays-only gate open

        const offHtml = renderRemotePanel(state, getLabels(state));
        expect(offHtml).not.toContain('data-art-url');
        scanArtwork();
        expect(FakeImage.instances).toHaveLength(0);

        settingsView.settings.enableSpeakerControl = true;
        const onHtml = renderRemotePanel(state, getLabels(state));
        expect(onHtml).toContain(`data-art-url="${HTTP_ART}"`);
    });
});

describe('settings popup (decision 10)', () => {
    it('renders exactly three setting-row checkboxes plus the Language select and the SoundTouch section', () => {
        render();
        setupEvents();
        openPopup();

        const rows = document.querySelectorAll('.modal-body .setting-row');
        expect(rows).toHaveLength(3);
        expect(document.querySelector('#settingEnablePreview')).not.toBeNull();
        expect(document.querySelector('#settingHideRemoteSkipButtons')).not.toBeNull();
        expect(document.querySelector('#settingEnableSpeakerControl')).not.toBeNull();
        expect(document.querySelector('#settingLanguage')).not.toBeNull();
        expect(document.querySelector('.soundtouch-section')).not.toBeNull();
    });

    it.each<'available' | 'checking'>(['available', 'checking'])(
        'while off with a saved address (%s), the SoundTouch status line shows the localized off-message',
        (statusValue) => {
            state.soundtouchStatus = statusValue;
            render();
            setupEvents();
            openPopup();

            const status = document.querySelector<HTMLElement>('.soundtouch-section .soundtouch-status');
            expect(status).not.toBeNull();
            expect(status!.textContent).toContain(getLabels(state).speakerControlOffHint);
            expect(status!.textContent).not.toContain(getLabels(state).checking);
            expect(status!.textContent).not.toContain(getLabels(state).reachable);
        }
    );

    it('while off without a saved address, the status line shows the off-message instead of the dash', () => {
        state.soundtouchAddress = '';
        state.skippedSetup = true;
        state.soundtouchStatus = 'idle';
        render();
        setupEvents();
        openPopup();

        const status = document.querySelector<HTMLElement>('.soundtouch-section .soundtouch-status');
        expect(status).not.toBeNull();
        expect(status!.textContent).toContain(getLabels(state).speakerControlOffHint);
    });

    it('toggle paths preserve the popup overlay/panel nodes and the station list (no-blink contract)', () => {
        state.stations = [STATION];
        render();
        setupEvents();
        openPopup();
        const overlay = document.querySelector('.modal-overlay');
        const panel = document.querySelector('.modal-panel');
        const list = document.querySelector('.station-list');
        expect(overlay).not.toBeNull();
        expect(panel).not.toBeNull();
        expect(list).not.toBeNull();

        flipSpeakerControl(false);
        expect(document.querySelector('.modal-overlay')).toBe(overlay);
        expect(document.querySelector('.modal-panel')).toBe(panel);
        expect(document.querySelector('.station-list')).toBe(list);

        flipSpeakerControl(true);
        expect(document.querySelector('.modal-overlay')).toBe(overlay);
        expect(document.querySelector('.modal-panel')).toBe(panel);
    });

    it('syncSettingsModalState keeps the third checkbox synced after reset', () => {
        settingsView.settings.enableSpeakerControl = true;
        state.stations = [STATION];
        render();
        setupEvents();
        openPopup();
        const cb = document.querySelector<HTMLInputElement>('#settingEnableSpeakerControl');
        expect(cb).not.toBeNull();
        expect(cb!.checked).toBe(true);

        document.querySelector<HTMLButtonElement>('#resetSettings')!.click();

        expect(cb!.checked).toBe(false); // same node, re-synced — not rebuilt
        expect(settingsView.settings.enableSpeakerControl).toBe(false);
        expect(document.querySelector('.modal-overlay')).not.toBeNull();
    });

    it('relabelSettingsModal keeps the third row label live after a language switch', () => {
        render();
        setupEvents();
        openPopup();
        const label = document.getElementById('settingEnableSpeakerControlLabel');
        expect(label).not.toBeNull();
        const select = document.querySelector<HTMLSelectElement>('#settingLanguage');
        expect(select).not.toBeNull();

        select!.value = 'de';
        select!.dispatchEvent(new Event('change', { bubbles: true }));

        expect(label!.textContent).toBe(getLabels({ language: 'de' }).settingEnableSpeakerControl);
        expect(document.querySelector('.modal-overlay')).not.toBeNull(); // popup survived the relabel
    });
});

describe('i18n parity (decision 11)', () => {
    it.each<['en' | 'de' | 'ru' | 'ukr']>([['en'], ['de'], ['ru'], ['ukr']])(
        '%s ships settingEnableSpeakerControl and speakerControlOffHint',
        (lang) => {
            expect(typeof tView[lang].settingEnableSpeakerControl).toBe('string');
            expect(tView[lang].settingEnableSpeakerControl.length).toBeGreaterThan(0);
            expect(typeof tView[lang].speakerControlOffHint).toBe('string');
            expect(tView[lang].speakerControlOffHint.length).toBeGreaterThan(0);
        }
    );

    it('keeps the four dictionaries in key parity after wave 12', () => {
        const enKeys = Object.keys(tView.en).sort();
        for (const lang of ['de', 'ru', 'ukr'] as const) {
            expect(Object.keys(tView[lang]).sort()).toEqual(enKeys);
        }
    });
});
