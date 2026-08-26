import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, state } from '../src/app';
import { setupEvents } from '../src/events';
import { translations, getLabels } from '../src/i18n';
import { defaultSettings } from '../src/settings';
import { getAudioElement } from '../src/player';

const LS_LANGUAGE = 'radio-browser-language';
const LS_SOUNDTOUCH = 'radio-browser-soundtouch-host';
const LS_FAVORITES = 'radio-browser-favorites';
const LS_SETTINGS = 'radio-browser-settings';

// State typed view — soundtouchStatus/wsStatus/device fields land with FR-3
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

// Settings typed view — hideRemoteSkipButtons default true
const settingsView = state as unknown as {
    settings: { enablePreview: boolean; hideRemoteSkipButtons: boolean };
};

// i18n view — remoteRetry lands with this feature
const tView = translations as unknown as Record<string, Record<string, string>>;

// Plain global lookup stubs — module must resolve WebSocket/Image at construction time
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

// Flush microtasks — mirrors existing ws tests (Promise.resolve ×3)
const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
};

// hanging fetch — never settles until AbortSignal fires (exercises 5s timeout path)
const hangingFetch = () => (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    state.language = 'en';
    state.soundtouchAddress = '192.168.1.42';
    (wsState as any).soundtouchStatus = 'available';
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
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// ───────────────────────────────── Rendering ─────────────────────────────────

describe('remote reload — rendering', () => {
    it('not configured (address "") → no .remote-panel even if status forced unreachable', () => {
        state.soundtouchAddress = '';
        (wsState as any).soundtouchStatus = 'unreachable';
        wsState.wsStatus = 'reconnecting';
        state.skippedSetup = true;
        render();
        expect(document.querySelector('.remote-panel')).toBeNull();
        expect(document.querySelector('#remotePlayPause')).toBeNull();
    });

    it('configured + reachable → shows play/pause, disabled when not connected, not reload', () => {
        (wsState as any).soundtouchStatus = 'available';
        wsState.wsStatus = 'reconnecting';
        render();
        const btn = document.querySelector('#remotePlayPause') as HTMLButtonElement;
        expect(btn).not.toBeNull();
        expect(btn.disabled).toBe(true);
        // aria-label is remotePlay or remotePause localized, not reload
        const label = btn.getAttribute('aria-label');
        expect([tView.en.remotePlay, tView.en.remotePause]).toContain(label);
        expect(btn.innerHTML).not.toContain('M17.65 6.35');
        // next/prev/volume/mute stay disabled while disconnected
        expect((document.querySelector('#remoteVolume') as HTMLInputElement).disabled).toBe(true);
        expect((document.querySelector('#remoteMute') as HTMLButtonElement).disabled).toBe(true);
        // hideRemoteSkipButtons solo still works — default true hides next/prev
        expect(document.querySelector('#remoteNext')).toBeNull();
        expect(document.querySelector('#remotePrev')).toBeNull();
        expect(document.querySelector('.remote-transport')).not.toBeNull();
        expect(document.querySelector('.remote-transport')!.classList.contains('remote-transport--solo')).toBe(true);
    });

    it('configured + reachable + connected → play/pause enabled, not reload, aria-label localized', () => {
        (wsState as any).soundtouchStatus = 'available';
        wsState.wsStatus = 'connected';
        wsState.devicePlayStatus = 'PLAY_STATE';
        render();
        const btn = document.querySelector('#remotePlayPause') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
        expect(btn.getAttribute('aria-label')).toBe(tView.en.remotePause);
        expect(btn.getAttribute('title')).toBe(tView.en.remotePause);
        expect(btn.innerHTML).not.toContain('M17.65 6.35');
        // when playing, label is Pause; when not playing it flips
        wsState.devicePlayStatus = 'STOP_STATE';
        render();
        const btn2 = document.querySelector('#remotePlayPause') as HTMLButtonElement;
        expect(btn2.getAttribute('aria-label')).toBe(tView.en.remotePlay);
    });

    it('configured + checking → while checking, button shows play/pause disabled (pinned choice)', () => {
        // Pin: while checking the button is disabled play/pause, not reload enabled.
        // Documented choice — implementation may keep reload disabled instead, but
        // must document the alternative.
        (wsState as any).soundtouchStatus = 'checking';
        wsState.wsStatus = 'reconnecting';
        render();
        const btn = document.querySelector('#remotePlayPause') as HTMLButtonElement;
        expect(btn).not.toBeNull();
        expect(btn.disabled).toBe(true);
        expect(btn.innerHTML).not.toContain('M17.65 6.35');
        // optionally shows Checking… in status, but must not be reload
        expect(btn.getAttribute('aria-label')).not.toBe(tView.en.remoteRetry);
    });

    it('configured + unreachable (core) → #remotePower enabled with reload icon, localized aria-label/title, retains id and btn classes', () => {
        (wsState as any).soundtouchStatus = 'unreachable';
        wsState.wsStatus = 'reconnecting';
        render();
        const btn = document.querySelector('#remotePower') as HTMLButtonElement;
        expect(btn).not.toBeNull();
        expect(btn.id).toBe('remotePower');
        expect(btn.classList.contains('btn')).toBe(true);
        expect(btn.classList.contains('btn-secondary')).toBe(true);
        expect(btn.disabled).toBe(false);
        // reload SVG contract
        expect(btn.innerHTML).toContain('M17.65 6.35');
        const svg = btn.querySelector('svg');
        expect(svg).not.toBeNull();
        expect(svg!.getAttribute('viewBox')).toBe('0 0 24 24');
        expect(svg!.getAttribute('fill')).toBe('currentColor');
        expect(svg!.getAttribute('aria-hidden')).toBe('true');
        expect(svg!.getAttribute('focusable')).toBe('false');
        // 24x24 icon inside 48x48 button — svg attributes width/height 24, button fixed 48x48 via CSS class
        // At minimum svg must be 24x24; we check viewBox and that outerHTML mentions 24
        expect(svg!.outerHTML).toContain('M17.65 6.35');
        // localized aria-label/title === t.remoteRetry for en
        expect(btn.getAttribute('aria-label')).toBe(tView.en.remoteRetry);
        expect(btn.getAttribute('title')).toBe(tView.en.remoteRetry);
        // playPause remains play, disabled; next/prev/volume/mute remain disabled, power now enabled
        const playBtn = document.querySelector('#remotePlayPause') as HTMLButtonElement;
        expect(playBtn.disabled).toBe(true);
        expect(playBtn.innerHTML).not.toContain('M17.65 6.35');
        expect(playBtn.innerHTML).toContain('M8 5v14');
        // need hideRemoteSkipButtons false to see next/prev presence but still disabled
        settingsView.settings.hideRemoteSkipButtons = false;
        render();
        const btnAfter = document.querySelector('#remotePower') as HTMLButtonElement;
        expect(btnAfter.disabled).toBe(false);
        expect((document.querySelector('#remoteNext') as HTMLButtonElement).disabled).toBe(true);
        expect((document.querySelector('#remotePrev') as HTMLButtonElement).disabled).toBe(true);
        expect((document.querySelector('#remoteVolume') as HTMLInputElement).disabled).toBe(true);
        expect((document.querySelector('#remoteMute') as HTMLButtonElement).disabled).toBe(true);
        expect((document.querySelector('#remotePlayPause') as HTMLButtonElement).disabled).toBe(true);
        // hideRemoteSkipButtons collapse still centred — solo class when default true
        settingsView.settings.hideRemoteSkipButtons = true;
        render();
        expect(document.querySelector('.remote-transport')!.classList.contains('remote-transport--solo')).toBe(true);
        const soloBtns = document.querySelectorAll('.remote-transport .btn');
        expect(soloBtns.length).toBe(1);
        expect(soloBtns[0].id).toBe('remotePlayPause');
    });

    it('configured + unreachable with idle wsStatus also shows reload enabled and localized', () => {
        (wsState as any).soundtouchStatus = 'unreachable';
        wsState.wsStatus = 'idle';
        render();
        const btn = document.querySelector('#remotePower') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
        expect(btn.innerHTML).toContain('M17.65 6.35');
        expect(btn.getAttribute('aria-label')).toBe(tView.en.remoteRetry);
        // playPause stays disabled and shows play icon
        const playBtn = document.querySelector('#remotePlayPause') as HTMLButtonElement;
        expect(playBtn.disabled).toBe(true);
        expect(playBtn.innerHTML).not.toContain('M17.65 6.35');
    });

    it.each<[string, string]>([
        ['en', 'Retry'],
        ['de', 'Erneut versuchen'],
        ['ru', 'Повторить'],
        ['ukr', 'Повторити'],
    ])('aria-label/title === remoteRetry for language %s', (lang, expected) => {
        (state as any).language = lang as any;
        (wsState as any).soundtouchStatus = 'unreachable';
        wsState.wsStatus = 'reconnecting';
        render();
        const btn = document.querySelector('#remotePower') as HTMLButtonElement;
        expect(btn.getAttribute('aria-label')).toBe(expected);
        expect(btn.getAttribute('title')).toBe(expected);
    });

    it('fallback to en when remoteRetry translation missing', () => {
        const saved = tView.ru.remoteRetry;
        (tView.ru as any).remoteRetry = undefined;
        try {
            (state as any).language = 'ru';
            (wsState as any).soundtouchStatus = 'unreachable';
            wsState.wsStatus = 'reconnecting';
            render();
            const btn = document.querySelector('#remotePower') as HTMLButtonElement;
            expect(btn.getAttribute('aria-label')).toBe(tView.en.remoteRetry);
            expect(btn.getAttribute('title')).toBe(tView.en.remoteRetry);
        } finally {
            tView.ru.remoteRetry = saved;
        }
    });

    it('has remoteRetry in all four languages with non-empty values', () => {
        for (const lang of ['en', 'de', 'ru', 'ukr'] as const) {
            expect(tView[lang].remoteRetry?.trim()).toBeTruthy();
        }
        // key parity — same keys in all languages
        for (const lang of ['de', 'ru', 'ukr'] as const) {
            expect(Object.keys(tView[lang])).toEqual(Object.keys(tView.en));
        }
    });

    it('hides no .remote-panel when not configured even with explicit unreachable banner state', () => {
        state.soundtouchAddress = '';
        state.skippedSetup = true;
        (wsState as any).soundtouchStatus = 'unreachable';
        wsState.wsStatus = 'reconnecting';
        render();
        expect(document.querySelector('.remote-panel')).toBeNull();
        // configured then unreachable does render the panel (banner may show too)
        state.soundtouchAddress = '192.168.1.42';
        render();
        expect(document.querySelector('.remote-panel')).not.toBeNull();
    });
});

// ───────────────────────────────── Interaction ─────────────────────────────────

describe('remote reload — interaction', () => {
    it('click reload triggers single fetch to http://<host>:8090/info and one WS ws://<host>:8080/ gabbo', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        (wsState as any).soundtouchStatus = 'unreachable';
        wsState.wsStatus = 'reconnecting';
        render();
        setupEvents();

        document.querySelector<HTMLButtonElement>('#remotePower')!.click();
        await flush();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://192.168.1.42:8090/info');
        expect(init.method).toBe('GET');
        expect(init.mode).toBe('no-cors');
        expect((init.signal as AbortSignal)).toBeInstanceOf(AbortSignal);

        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(FakeWebSocket.instances[0].url).toBe('ws://192.168.1.42:8080/');
        expect(FakeWebSocket.instances[0].protocols).toEqual(['gabbo']);

        // clicking sets checking then quickly available after ping; wsStatus still connecting so UI still shows Checking…
        expect((wsState as any).soundtouchStatus).toBe('available');
        expect(document.querySelector('#app')!.textContent).toContain(getLabels(state).checking);
    });

    it('honours explicit port for fetch and WS', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        state.soundtouchAddress = '192.168.1.42:1234';
        (wsState as any).soundtouchStatus = 'unreachable';
        wsState.wsStatus = 'idle';
        render();
        setupEvents();

        document.querySelector<HTMLButtonElement>('#remotePower')!.click();
        await flush();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('http://192.168.1.42:1234/info');
        expect(FakeWebSocket.instances[0].url).toBe('ws://192.168.1.42:1234/');
    });

    it('second click while checking does not add fetch/WS (ignored)', async () => {
        const fetchMock = vi.fn().mockImplementation(hangingFetch());
        vi.stubGlobal('fetch', fetchMock);
        (wsState as any).soundtouchStatus = 'unreachable';
        wsState.wsStatus = 'reconnecting';
        render();
        setupEvents();

        document.querySelector<HTMLButtonElement>('#remotePower')!.click();
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(FakeWebSocket.instances).toHaveLength(1);
        expect((wsState as any).soundtouchStatus).toBe('checking');

        // second click while still checking — should be ignored
        document.querySelector<HTMLButtonElement>('#remotePower')!.click();
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('stale-host guard — host changed before probe resolves applies nothing', async () => {
        let resolveFetch!: (v: Response) => void;
        const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(res => { resolveFetch = res; }));
        vi.stubGlobal('fetch', fetchMock);
        (wsState as any).soundtouchStatus = 'unreachable';
        wsState.wsStatus = 'reconnecting';
        render();
        setupEvents();

        document.querySelector<HTMLButtonElement>('#remotePower')!.click();
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect((wsState as any).soundtouchStatus).toBe('checking');

        // user changed address before probe settled
        state.soundtouchAddress = '192.168.1.99';

        resolveFetch({} as Response);
        await flush();
        // stale probe must not overwrite the new address's checking state to available
        expect((wsState as any).soundtouchStatus).toBe('checking');
        // stale WS should be ignored — currentHost guard keeps old socket from affecting new host
        // At least no crash, and no available status
        expect(state.soundtouchAddress).toBe('192.168.1.99');
    });

    it('success → available + requestSnapshot (3 msgs) and reverts to play/pause', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        (wsState as any).soundtouchStatus = 'unreachable';
        wsState.wsStatus = 'reconnecting';
        render();
        setupEvents();

        document.querySelector<HTMLButtonElement>('#remotePower')!.click();
        await flush();

        const ws = FakeWebSocket.instances[0];
        ws.open();
        await flush();

        // fetch ok → available
        expect((wsState as any).soundtouchStatus).toBe('available');
        expect(wsState.wsStatus).toBe('connected');
        // snapshot 3 msgs
        expect(ws.sent).toHaveLength(3);
        expect(ws.sent[0]).toContain('url="now_playing"');
        expect(ws.sent[1]).toContain('url="volume"');
        expect(ws.sent[2]).toContain('url="info"');
        for (const sent of ws.sent) {
            expect(sent).toContain('<request requestID="');
        }
        // reverts to power (reload gone), playPause stays play
        const powerBtn = document.querySelector('#remotePower') as HTMLButtonElement;
        expect(powerBtn.innerHTML).not.toContain('M17.65 6.35');
        expect(powerBtn.innerHTML).toContain('M13 3h-2v10');
        const playBtn = document.querySelector('#remotePlayPause') as HTMLButtonElement;
        expect(playBtn.innerHTML).not.toContain('M17.65 6.35');
        expect(document.querySelector('.offline-banner')).toBeNull();
    });

    it('failure → stays unreachable with banner, retains reload', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
        vi.stubGlobal('fetch', fetchMock);
        (wsState as any).soundtouchStatus = 'unreachable';
        wsState.wsStatus = 'reconnecting';
        render();
        setupEvents();

        document.querySelector<HTMLButtonElement>('#remotePower')!.click();
        await flush();
        // fetch rejected → stays unreachable
        expect((wsState as any).soundtouchStatus).toBe('unreachable');
        expect(document.querySelector('.offline-banner')).not.toBeNull();
        const btn = document.querySelector('#remotePower') as HTMLButtonElement;
        expect(btn.innerHTML).toContain('M17.65 6.35');
        expect(btn.disabled).toBe(false);
        const playBtn = document.querySelector('#remotePlayPause') as HTMLButtonElement;
        expect(playBtn.disabled).toBe(true);
    });

    it('non-unreachable click does not fetch/WS (play path)', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        (wsState as any).soundtouchStatus = 'available';
        wsState.wsStatus = 'connected';
        wsState.devicePlayStatus = 'PAUSE_STATE';
        render();
        setupEvents();

        FakeWebSocket.instances = [];
        fetchMock.mockClear();

        // clicking play while reachable should send key press, not reload probe
        document.querySelector<HTMLButtonElement>('#remotePlayPause')!.click();
        await flush();

        // fetch may be called for key press POST, but not for /info probe
        const infoCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/info'));
        expect(infoCalls).toHaveLength(0);
        // no new WS for reload
        expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it('click via inner svg/path also triggers reload', async () => {
        const fetchMock = vi.fn().mockResolvedValue({} as Response);
        vi.stubGlobal('fetch', fetchMock);
        (wsState as any).soundtouchStatus = 'unreachable';
        wsState.wsStatus = 'idle';
        render();
        setupEvents();

        document.querySelector('#remotePower svg')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(FakeWebSocket.instances).toHaveLength(1);
    });
});
