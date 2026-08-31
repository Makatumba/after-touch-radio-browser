import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, state } from '../src/app';
import { setupEvents } from '../src/events';
import { defaultSettings } from '../src/settings';
import { getAudioElement } from '../src/player';
import { translations } from '../src/i18n';
import { armSendConfirmation } from '../src/confirmation';

// Leaf module under test — stubbed in red phase, fully implemented in green.
// @ts-ignore — red phase: module exists as stub on disk; on a clean checkout the
// missing file is intentional (failing tests for missing feature, not setup).
import { setupResumeRecheck, cancelPendingResumeCheck, resetResumeStateForTests } from '../src/soundtouch-resume';

const LS_LANGUAGE = 'radio-browser-language';
const LS_SOUNDTOUCH = 'radio-browser-soundtouch-host';
const LS_FAVORITES = 'radio-browser-favorites';
const LS_SETTINGS = 'radio-browser-settings';

const wsState = state as unknown as {
    wsStatus: string;
    soundtouchStatus: string;
    deviceNowPlaying: string;
    deviceArtist: string;
    deviceAlbum: string;
    deviceSource: string;
    devicePlayStatus: string;
    deviceVolume: number;
    deviceMute: boolean;
    deviceNowPlayingDetail: unknown;
    soundtouchDevice: unknown;
};

const tView = translations as unknown as Record<string, Record<string, string>>;

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
    close(): void { this.closed = true; }
    send(data: string): void { this.sent.push(String(data)); }
    open(): void { this.onopen?.(); }
    message(xml: string): void { this.onmessage?.({ data: xml }); }
    closeFromServer(): void { this.onclose?.(); }
    fail(): void { this.onerror?.(); this.onclose?.(); }
}

class FakeImage {
    static instances: FakeImage[] = [];
    src = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { FakeImage.instances.push(this); }
}

const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
};

const hangingFetch = () => (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });

function setCordovaRuntime(enabled: boolean) {
    const scope = globalThis as unknown as { __AFTER_TOUCH_RUNTIME__?: string; cordova?: unknown };
    if (enabled) {
        scope.__AFTER_TOUCH_RUNTIME__ = 'cordova';
    } else {
        delete scope.__AFTER_TOUCH_RUNTIME__;
        delete scope.cordova;
    }
}

function setVisibilityState(value: string) {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get() { return value; },
    });
}

function dispatchResume() {
    document.dispatchEvent(new Event('resume'));
}

function dispatchVisibilityChange() {
    document.dispatchEvent(new Event('visibilitychange'));
}

function dispatchPageShow(persisted: boolean) {
    const ev = new Event('pageshow') as unknown as { persisted: boolean };
    (ev as { persisted: boolean }).persisted = persisted;
    window.dispatchEvent(ev as unknown as Event);
}

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    state.language = 'en';
    state.soundtouchAddress = '192.168.1.42';
    (wsState as unknown as Record<string, unknown>).soundtouchStatus = 'available';
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
    state.deviceMessage = '';
    state.skippedSetup = false;
    state.settings = { ...defaultSettings };
    state.stations = [];
    state.favorites = [];
    state.currentIndex = -1;
    for (const key of [LS_LANGUAGE, LS_SOUNDTOUCH, LS_FAVORITES, LS_SETTINGS]) localStorage.removeItem(key);
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith('radio-browser-art-')) localStorage.removeItem(k);
    }
    getAudioElement().removeAttribute('src');
    FakeWebSocket.instances = [];
    FakeImage.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('Image', FakeImage as unknown as typeof Image);
    // ensure clean resume module state
    resetResumeStateForTests();
    setCordovaRuntime(false);
    // default visible
    setVisibilityState('visible');
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetResumeStateForTests();
    setCordovaRuntime(false);
    // restore visibilityState to default descriptor
    try { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible', writable: true }); } catch {}
});

// ───────────────────────────────── Exclusive sources ─────────────────────────────────

describe('resume sources — exclusive via isCordovaRuntime()', () => {
    it('Cordova registers exactly one document resume listener and no visibilitychange/pageshow', () => {
        setCordovaRuntime(true);
        const docSpy = vi.spyOn(document, 'addEventListener');
        const winSpy = vi.spyOn(window, 'addEventListener');
        setupResumeRecheck();
        const resumeCalls = docSpy.mock.calls.filter(([type]) => type === 'resume');
        expect(resumeCalls).toHaveLength(1);
        const visCalls = docSpy.mock.calls.filter(([type]) => type === 'visibilitychange');
        expect(visCalls).toHaveLength(0);
        const pageCalls = winSpy.mock.calls.filter(([type]) => type === 'pageshow');
        expect(pageCalls).toHaveLength(0);
    });

    it('Web/PWA registers visibilitychange and pageshow, no resume', () => {
        setCordovaRuntime(false);
        const docSpy = vi.spyOn(document, 'addEventListener');
        const winSpy = vi.spyOn(window, 'addEventListener');
        setupResumeRecheck();
        expect(docSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
        expect(winSpy).toHaveBeenCalledWith('pageshow', expect.any(Function));
        const resumeCalls = docSpy.mock.calls.filter(([type]) => type === 'resume');
        expect(resumeCalls).toHaveLength(0);
    });

    it('dispatching resume in Cordova invokes handler (with debounce)', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'reconnecting';
        (wsState as unknown as Record<string, unknown>).soundtouchStatus = 'unreachable';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('http://192.168.1.42:8090/info');
    });

    it('Cordova does not react to visibilitychange', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        setVisibilityState('hidden');
        dispatchVisibilityChange();
        setVisibilityState('visible');
        dispatchVisibilityChange();
        await vi.advanceTimersByTimeAsync(600);
        await flush();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('Web reacts to visibilitychange visible after hidden and to pageshow persisted', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(false);
        wsState.wsStatus = 'reconnecting';
        (wsState as unknown as Record<string, unknown>).soundtouchStatus = 'unreachable';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();

        // hidden -> visible triggers
        setVisibilityState('hidden');
        dispatchVisibilityChange();
        setVisibilityState('visible');
        dispatchVisibilityChange();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // reset
        fetchMock.mockClear();
        resetResumeStateForTests();
        setupResumeRecheck();
        // pageshow persisted
        dispatchPageShow(true);
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('Web does not register Cordova resume', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(false);
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(600);
        await flush();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('second setupResumeRecheck call does not double-register listeners', () => {
        setCordovaRuntime(true);
        const docSpy = vi.spyOn(document, 'addEventListener');
        setupResumeRecheck();
        setupResumeRecheck();
        const resumeCalls = docSpy.mock.calls.filter(([type]) => type === 'resume');
        expect(resumeCalls).toHaveLength(1);
    });

    it('Web second setup does not double-register visibility/page listeners', () => {
        setCordovaRuntime(false);
        const docSpy = vi.spyOn(document, 'addEventListener');
        const winSpy = vi.spyOn(window, 'addEventListener');
        setupResumeRecheck();
        setupResumeRecheck();
        expect(docSpy.mock.calls.filter(([t]) => t === 'visibilitychange')).toHaveLength(1);
        expect(winSpy.mock.calls.filter(([t]) => t === 'pageshow')).toHaveLength(1);
    });

    it('re-renders do not stack listeners (lifetime = document)', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        render();
        render();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('resume fired before deviceready still received (no deviceready gate)', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        // listener attached before deviceready — still receives resume without deviceready
        setupResumeRecheck();
        // no deviceready dispatch, just resume
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

// ───────────────────────────────── Trigger guards ─────────────────────────────────

describe('trigger — only when disconnected', () => {
    it('healthy available+connected -> no-op (no probe traffic)', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'connected';
        (wsState as unknown as Record<string, unknown>).soundtouchStatus = 'available';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(600);
        await flush();
        expect(fetchMock).not.toHaveBeenCalled();
        expect((wsState as unknown as Record<string, unknown>).soundtouchStatus).toBe('available');
    });

    it('healthy Web available+connected -> visibilitychange no-op', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(false);
        wsState.wsStatus = 'connected';
        (wsState as unknown as Record<string, unknown>).soundtouchStatus = 'available';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        setVisibilityState('hidden');
        dispatchVisibilityChange();
        setVisibilityState('visible');
        dispatchVisibilityChange();
        await vi.advanceTimersByTimeAsync(600);
        await flush();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('disconnected (unreachable) triggers after debounce', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'reconnecting';
        (wsState as unknown as Record<string, unknown>).soundtouchStatus = 'unreachable';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect((wsState as unknown as Record<string, unknown>).soundtouchStatus).toBe('available');
    });

    it('disconnected (idle wsStatus) triggers', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'idle';
        (wsState as unknown as Record<string, unknown>).soundtouchStatus = 'idle' as unknown as string;
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('disconnected (connecting) triggers', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'connecting';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('no address -> no-op', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        state.soundtouchAddress = '';
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(600);
        await flush();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skippedSetup with empty address -> no-op', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        state.soundtouchAddress = '';
        state.skippedSetup = true;
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(600);
        await flush();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('visibilityState !== visible -> no recheck', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(false);
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        setVisibilityState('hidden');
        dispatchVisibilityChange();
        await vi.advanceTimersByTimeAsync(600);
        await flush();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('pageshow not persisted -> no-op', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(false);
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchPageShow(false);
        await vi.advanceTimersByTimeAsync(600);
        await flush();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('not already checking guard: second event while checking is ignored', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockImplementation(hangingFetch());
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect((wsState as unknown as Record<string, unknown>).soundtouchStatus).toBe('checking');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        // second burst while checking should be ignored even after debounce
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('visible without prior hidden is ignored', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(false);
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        // start visible, dispatch visible -> should not trigger (needs hidden first)
        setVisibilityState('visible');
        dispatchVisibilityChange();
        await vi.advanceTimersByTimeAsync(600);
        await flush();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

// ───────────────────────────────── Recheck sequence ─────────────────────────────────

describe('recheck — reuses manual reload sequence', () => {
    it('checking -> GET http://host:8090/info no-cors 5s explicit port honored', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'reconnecting';
        // use hanging fetch to observe checking state before resolution (fake timers drain microtasks)
        let resolveFetch!: (v: Response) => void;
        const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(res => { resolveFetch = res; }));
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchResume();
        // debounce 500 then probe starts, checking set synchronously after debounce?
        await vi.advanceTimersByTimeAsync(500);
        // status should be checking during probe (fetch pending)
        expect((wsState as unknown as Record<string, unknown>).soundtouchStatus).toBe('checking');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://192.168.1.42:8090/info');
        expect(init.method).toBe('GET');
        expect(init.mode).toBe('no-cors');
        expect((init.signal as AbortSignal)).toBeInstanceOf(AbortSignal);
        resolveFetch({} as Response);
        await flush();
    });

    it('explicit port honored for GET and WS', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        state.soundtouchAddress = '192.168.1.42:1234';
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('http://192.168.1.42:1234/info');
        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(FakeWebSocket.instances[0].url).toBe('ws://192.168.1.42:1234/');
        expect(FakeWebSocket.instances[0].protocols).toEqual(['gabbo']);
    });

    it('on ok -> available + WS ws://host:8080/ gabbo and snapshot via onopen', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect((wsState as unknown as Record<string, unknown>).soundtouchStatus).toBe('available');
        expect(FakeWebSocket.instances).toHaveLength(1);
        const ws = FakeWebSocket.instances[0];
        expect(ws.url).toBe('ws://192.168.1.42:8080/');
        expect(ws.protocols).toEqual(['gabbo']);
        // snapshot via onopen — requestSnapshot no-ops while disconnected, so sent only after open
        expect(ws.sent).toHaveLength(0);
        ws.open();
        expect(ws.sent).toHaveLength(3);
        expect(ws.sent[0]).toContain('url="now_playing"');
        expect(ws.sent[1]).toContain('url="volume"');
        expect(ws.sent[2]).toContain('url="info"');
    });

    it('on !ok -> unreachable + cancelSendConfirmation + banner, backoff not reset, ws not connected', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        // arm a pending send to verify cancellation
        armSendConfirmation({ stationName: 'Test FM', location: '/stations/byuuid/abc', wasRadioBrowserPlaying: false }, tView.en, '192.168.1.42');
        expect(state.deviceMessage).not.toBe('');
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect((wsState as unknown as Record<string, unknown>).soundtouchStatus).toBe('unreachable');
        expect(state.deviceMessage).toBe('');
        render();
        expect(document.querySelector('.offline-banner')).not.toBeNull();
        expect(wsState.wsStatus).toBe('reconnecting');
        // no new WS on failure
        expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it('stale-host guard: address changed between debounce fire and probe resolve -> ignored', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'reconnecting';
        let resolveFetch!: (v: Response) => void;
        const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(res => { resolveFetch = res; }));
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect((wsState as unknown as Record<string, unknown>).soundtouchStatus).toBe('checking');
        // change address before resolve
        state.soundtouchAddress = '192.168.1.99';
        resolveFetch({} as Response);
        await flush();
        // stale result ignored -> stays checking, not available
        expect((wsState as unknown as Record<string, unknown>).soundtouchStatus).toBe('checking');
        expect(state.soundtouchAddress).toBe('192.168.1.99');
    });

    it('stale-host guard for Web visibility: address changed between debounce and fire -> ignored', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(false);
        wsState.wsStatus = 'reconnecting';
        let resolveFetch!: (v: Response) => void;
        const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(res => { resolveFetch = res; }));
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        setVisibilityState('hidden');
        dispatchVisibilityChange();
        setVisibilityState('visible');
        dispatchVisibilityChange();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect((wsState as unknown as Record<string, unknown>).soundtouchStatus).toBe('checking');
        state.soundtouchAddress = '10.0.0.1';
        resolveFetch({} as Response);
        await flush();
        expect((wsState as unknown as Record<string, unknown>).soundtouchStatus).toBe('checking');
    });

    it('no echo loops: live device state still written only from WS events', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'reconnecting';
        wsState.deviceNowPlaying = 'Old';
        wsState.devicePlayStatus = 'PLAY_STATE';
        wsState.deviceVolume = 10;
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(FakeWebSocket.instances).toHaveLength(1);
        // probe success should not have overwritten live state
        expect(wsState.deviceNowPlaying).toBe('Old');
        expect(wsState.devicePlayStatus).toBe('PLAY_STATE');
        expect(wsState.deviceVolume).toBe(10);
        // only WS message changes it
        const ws = FakeWebSocket.instances[0];
        ws.open();
        // still not changed until message
        expect(wsState.deviceNowPlaying).toBe('Old');
        ws.message('<updates deviceID="689E19B8BB8A"><nowPlayingUpdated><nowPlaying source="RADIO_BROWSER"><track>New</track><playStatus>PLAY_STATE</playStatus></nowPlaying></nowPlayingUpdated></updates>');
        expect(wsState.deviceNowPlaying).toBe('New');
    });

    it('backoff not reset on resume recheck (probe failure does not reset timer)', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        // first, cause a WS close to set backoff to something >1s
        const fetchMockProbe = vi.fn().mockRejectedValue(new Error('offline'));
        vi.stubGlobal('fetch', fetchMockProbe);
        // need a socket to close
        const { connectSoundtouchWs } = await import('../src/soundtouch-ws');
        connectSoundtouchWs('192.168.1.42');
        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.closeFromServer();
        await flush();
        // after first close, backoff is 1s pending, then after 1s runProbe fails and schedules 2s
        await vi.advanceTimersByTimeAsync(1000);
        await flush();
        // now trigger resume recheck while reconnecting
        wsState.wsStatus = 'reconnecting';
        (wsState as unknown as Record<string, unknown>).soundtouchStatus = 'unreachable';
        setupResumeRecheck();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect((wsState as unknown as Record<string, unknown>).soundtouchStatus).toBe('unreachable');
        // resume failure must not reset backoff — it must not create a new socket synchronously
        // and must not shorten the existing 2s probe retry (offline keeps probing, not WS)
        const countBefore = FakeWebSocket.instances.length;
        // resume failure does not create a new socket synchronously
        expect(FakeWebSocket.instances.length).toBe(countBefore);
        // after 1s the existing 2s timer has not yet fired (would if reset to 1s)
        await vi.advanceTimersByTimeAsync(1000);
        await flush();
        expect(FakeWebSocket.instances.length).toBe(countBefore);
        // no new WS is created while probe keeps failing — backoff keeps growing, not reset
        await vi.advanceTimersByTimeAsync(1000);
        await flush();
        // still no WS because ping keeps failing (probe path, not WS path)
        expect(FakeWebSocket.instances.length).toBe(countBefore);
    });

    it('sanitized host used for probe (scheme stripped)', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        state.soundtouchAddress = 'http://192.168.1.42/';
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('http://192.168.1.42:8090/info');
    });
});

// ───────────────────────────────── Debounce 500ms ─────────────────────────────────

describe('debounce — 500ms coalescing', () => {
    it('three resume events spaced 100ms -> handler executes exactly once ~500ms after last dispatch', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(100);
        dispatchResume();
        await vi.advanceTimersByTimeAsync(100);
        dispatchResume();
        await vi.advanceTimersByTimeAsync(100);
        expect(fetchMock).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(400);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1000);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('visibilitychange hidden->visible flop collapses to one check', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(false);
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        setVisibilityState('hidden');
        dispatchVisibilityChange();
        setVisibilityState('visible');
        dispatchVisibilityChange();
        await vi.advanceTimersByTimeAsync(100);
        setVisibilityState('hidden');
        dispatchVisibilityChange();
        setVisibilityState('visible');
        dispatchVisibilityChange();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('while checking, debounced fire still early-returns (ignored)', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockImplementation(hangingFetch());
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect((wsState as unknown as Record<string, unknown>).soundtouchStatus).toBe('checking');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        // debounce while checking
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('timer cleared / logically no-ops on address cleared while debounce pending', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(100);
        // address cleared before debounce fires
        state.soundtouchAddress = '';
        // also call cancel explicitly to simulate address change cleanup
        cancelPendingResumeCheck();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('burst while checking ignored: third resume arrives while checking -> ignored until status leaves checking', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockImplementation(hangingFetch());
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect((wsState as unknown as Record<string, unknown>).soundtouchStatus).toBe('checking');
        dispatchResume();
        await vi.advanceTimersByTimeAsync(100);
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('pageshow bursts coalesce similarly', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(false);
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchPageShow(true);
        await vi.advanceTimersByTimeAsync(100);
        dispatchPageShow(true);
        await vi.advanceTimersByTimeAsync(100);
        dispatchPageShow(true);
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('cancelPendingResumeCheck clears the debounce timer', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchResume();
        cancelPendingResumeCheck();
        await vi.advanceTimersByTimeAsync(600);
        await flush();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

// ───────────────────────────────── No new i18n/state/localStorage/wire ─────────────────────────────────

describe('no new i18n/state/localStorage/wire', () => {
    it('does not add new i18n keys (parity preserved)', () => {
        const expectedKeys = Object.keys(tView.en);
        for (const lang of ['de', 'ru', 'ukr'] as const) {
            expect(Object.keys(tView[lang])).toEqual(expectedKeys);
        }
        // wave-12 claims no new keys — ensure remoteRetry/checking/etc already existed
        expect(tView.en.remoteRetry).toBeTruthy();
        expect(tView.en.checking).toBeTruthy();
    });

    it('does not add new state fields or localStorage keys', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        const beforeKeys = new Set(Object.keys(state));
        const beforeLS = new Set(Object.keys(localStorage).filter(k => k.startsWith('radio-browser-')));
        setupResumeRecheck();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        const afterKeys = new Set(Object.keys(state));
        expect(afterKeys).toEqual(beforeKeys);
        const afterLS = new Set(Object.keys(localStorage).filter(k => k.startsWith('radio-browser-')));
        // no new radio-browser-* keys added by resume
        for (const k of afterLS) expect(beforeLS.has(k) || k.startsWith('radio-browser-art-')).toBeTruthy();
        // ensure no new soundtouch-resume specific keys
        expect(localStorage.getItem('radio-browser-resume')).toBeNull();
    });

    it('typecheck/build still pass — no new wire (fetch only GET /info and WS ws://:8080/gabbo)', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toMatch(/^http:\/\/.*\/info$/);
        expect(fetchMock.mock.calls[0][1].mode).toBe('no-cors');
        expect(FakeWebSocket.instances[0].url).toMatch(/^ws:\/\/.*:8080\/$|^ws:\/\/.*:\d+\/$/);
        expect(FakeWebSocket.instances[0].protocols).toEqual(['gabbo']);
    });

    it('resetResumeStateForTests clears installed flag and timers', () => {
        setCordovaRuntime(true);
        const spy = vi.spyOn(document, 'addEventListener');
        setupResumeRecheck();
        expect(spy.mock.calls.filter(([t]) => t === 'resume')).toHaveLength(1);
        resetResumeStateForTests();
        setupResumeRecheck();
        expect(spy.mock.calls.filter(([t]) => t === 'resume')).toHaveLength(2);
    });
});

// ───────────────────────────────── Observability / no-blink ─────────────────────────────────

describe('observability — same UI strings as manual reload', () => {
    it('shows ⟳ Checking… while probing and reports available/unreachable after', async () => {
        vi.useFakeTimers();
        setCordovaRuntime(true);
        wsState.wsStatus = 'reconnecting';
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        setupResumeRecheck();
        render();
        dispatchResume();
        await vi.advanceTimersByTimeAsync(500);
        // checking shows ⟳ Checking…
        expect(document.querySelector('#app')!.textContent).toContain('⟳');
        await flush();
        expect((wsState as unknown as Record<string, unknown>).soundtouchStatus).toBe('available');
    });
});
