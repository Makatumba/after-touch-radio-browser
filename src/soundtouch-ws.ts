import {state, render} from './app';
import {pingSoundtouch, sanitizeHost, soundtouchWsUrl} from './actions';

const BACKOFF_START_MS = 1000;
const BACKOFF_CAP_MS = 30000;
const PROBE_FAILURE_LIMIT = 3;
const PLAY_STATUSES = ['PLAY_STATE', 'PAUSE_STATE', 'BUFFERING_STATE', 'STOP_STATE'];

let socket: WebSocket | null = null;
let currentHost = '';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = BACKOFF_START_MS;
let probeFailures = 0;

function clearReconnect(): void {
    if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

/** ws-fed device state is cleared only on a host change or an explicit close. */
function clearDeviceState(): void {
    state.deviceNowPlaying = '';
    state.deviceArtist = '';
    state.deviceAlbum = '';
    state.deviceSource = '';
    state.devicePlayStatus = '';
    state.deviceVolume = 0;
    state.deviceMute = false;
    state.soundtouchDevice = null;
}

export function connectSoundtouchWs(raw: string): void {
    const host = sanitizeHost(raw);
    if (!host) return;
    if (host !== currentHost) clearDeviceState();
    if (socket) {
        const old = socket;
        socket = null;
        old.close();
    }
    clearReconnect();
    backoffMs = BACKOFF_START_MS;
    probeFailures = 0;
    currentHost = host;
    state.wsStatus = 'connecting';
    render();
    openSocket(host);
}

export function closeSoundtouchWs(): void {
    clearReconnect();
    if (socket) {
        const old = socket;
        socket = null;
        old.close();
    }
    currentHost = '';
    backoffMs = BACKOFF_START_MS;
    probeFailures = 0;
    clearDeviceState();
    state.wsStatus = 'idle';
    render();
}

function openSocket(host: string): void {
    const url = soundtouchWsUrl(host);
    if (!url) return;
    let ws: WebSocket;
    try {
        ws = new WebSocket(url, ['gabbo']);
    } catch {
        state.wsStatus = 'reconnecting';
        render();
        scheduleRetry(host, openSocket);
        return;
    }
    socket = ws;
    ws.onopen = () => {
        if (ws !== socket || host !== currentHost) return;
        backoffMs = BACKOFF_START_MS;
        probeFailures = 0;
        state.wsStatus = 'connected';
        render();
    };
    ws.onmessage = (ev: MessageEvent) => {
        if (ws !== socket || host !== currentHost) return;
        handleMessage(String(ev.data));
    };
    ws.onerror = () => {
        // an error is always followed by close; the close handler drives the reconnect
    };
    ws.onclose = () => {
        if (ws !== socket || host !== currentHost) return;
        handleClose(host);
    };
}

function handleClose(host: string): void {
    state.wsStatus = 'reconnecting';
    render();
    runProbe(host);
}

/**
 * Reachability probe: ok → reconnect the socket; fail → retry the probe on the
 * same backoff schedule, and only after repeated failures mark the device
 * unreachable (offline banner, controls disabled). Last-known state survives.
 */
function runProbe(host: string): void {
    clearReconnect();
    pingSoundtouch(host).then(ok => {
        if (currentHost !== host) return;
        if (ok) {
            probeFailures = 0;
            state.soundtouchStatus = 'available';
            render();
            scheduleRetry(host, openSocket);
        } else {
            probeFailures += 1;
            if (probeFailures >= PROBE_FAILURE_LIMIT) {
                state.soundtouchStatus = 'unreachable';
                render();
            }
            scheduleRetry(host, runProbe);
        }
    });
}

function scheduleRetry(host: string, retry: (host: string) => void): void {
    clearReconnect();
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, BACKOFF_CAP_MS);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (currentHost !== host) return;
        retry(host);
    }, delay);
}

function handleMessage(raw: string): void {
    let doc: Document;
    try {
        doc = new DOMParser().parseFromString(raw, 'text/xml');
    } catch {
        return;
    }
    if (doc.querySelector('parsererror')) return;
    const root = doc.documentElement;
    if (!root || root.tagName !== 'updates') return;

    const nowPlayingUpdated = root.querySelector('nowPlayingUpdated');
    const volumeUpdated = root.querySelector('volumeUpdated');
    const volumeWithData = volumeUpdated ? volumeUpdated.querySelector('volume') : null;

    let changed = false;

    // the deviceID attribute feeds the device-info widget; it is only taken
    // from messages the app actually uses (a signal-only or unknown event is
    // not enough to identify the device)
    if (nowPlayingUpdated || volumeWithData) {
        const deviceId =
            root.getAttribute('deviceID') ??
            root.querySelector('[deviceID]')?.getAttribute('deviceID') ??
            doc.querySelector('nowPlaying')?.getAttribute('deviceID');
        if (deviceId) {
            state.soundtouchDevice = {...(state.soundtouchDevice ?? {}), id: deviceId};
            changed = true;
        }
    }

    if (nowPlayingUpdated) {
        const np = nowPlayingUpdated.querySelector('nowPlaying');
        state.deviceNowPlaying = np?.querySelector('track')?.textContent?.trim() ?? '';
        state.deviceArtist = np?.querySelector('artist')?.textContent?.trim() ?? '';
        state.deviceAlbum = np?.querySelector('album')?.textContent?.trim() ?? '';
        state.deviceSource = np?.getAttribute('source') ?? '';
        const playStatus = np?.querySelector('playStatus')?.textContent?.trim() ?? '';
        state.devicePlayStatus = PLAY_STATUSES.includes(playStatus) ? playStatus : '';
        changed = true;
    }

    if (volumeWithData) {
        const actual = Number(volumeWithData.querySelector('actualvolume')?.textContent);
        const target = Number(volumeWithData.querySelector('targetvolume')?.textContent);
        if (!Number.isNaN(actual)) {
            state.deviceVolume = actual;
            changed = true;
        } else if (!Number.isNaN(target)) {
            state.deviceVolume = target;
            changed = true;
        }
        const mute = volumeWithData.querySelector('muteenabled')?.textContent;
        if (mute === 'true' || mute === 'false') {
            state.deviceMute = mute === 'true';
            changed = true;
        }
    }

    if (changed) render();
}
