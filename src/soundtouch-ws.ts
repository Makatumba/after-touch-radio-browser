import {render, state} from './app';
import {pingSoundtouch, sanitizeHost, soundtouchWsUrl} from './actions';
import {cancelSendConfirmation, evaluateNowPlaying} from './confirmation';

const BACKOFF_START_MS = 1000;
const BACKOFF_CAP_MS = 30000;
const PROBE_FAILURE_LIMIT = 3;
const PLAY_STATUSES = ['PLAY_STATE', 'PAUSE_STATE', 'BUFFERING_STATE', 'STOP_STATE'];
const SNAPSHOT_URLS = ['now_playing', 'volume', 'info'];

let socket: WebSocket | null = null;
let currentHost = '';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = BACKOFF_START_MS;
let probeFailures = 0;
// REST-proxy requestID — increments per snapshot request and resets to 1 on
// every connection (the response envelopes carry no other correlation).
let requestID = 0;

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
    state.deviceNowPlayingDetail = null;
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
    requestID = 0;
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
        sendSnapshot(ws, host);
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
            // no-op while the socket is still closed; the reopened socket's
            // onopen sends the snapshot
            requestSnapshot();
            scheduleRetry(host, openSocket);
        } else {
            probeFailures += 1;
            if (probeFailures >= PROBE_FAILURE_LIMIT) {
                state.soundtouchStatus = 'unreachable';
                // the offline banner covers the state — drop any pending confirmation
                cancelSendConfirmation();
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

/**
 * REST-proxy request envelope (API-NOTES.md "State snapshot"): the url
 * attribute has no leading slash, the deviceID attribute is required but may
 * be empty, and the requestID counts per request.
 */
function snapshotRequestXml(url: string, requestId: number, deviceId: string): string {
    return `<msg><header deviceID="${deviceId}" url="${url}" method="GET"><request requestID="${requestId}"><info type="new"/></request></header><body/></msg>`;
}

/**
 * Requests the state snapshot over the just-opened socket: now_playing,
 * volume, info. Writes no live state — the responses are applied only when
 * they arrive, and never optimistically (no echo loop).
 */
function sendSnapshot(ws: WebSocket, host: string): void {
    if (ws !== socket || host !== currentHost) return;
    const deviceId = state.soundtouchDevice?.id ?? '';
    for (const url of SNAPSHOT_URLS) {
        requestID += 1;
        ws.send(snapshotRequestXml(url, requestID, deviceId));
    }
}

/**
 * Re-requests the state snapshot when a (re)connection check succeeds —
 * at startup for a saved address, right after saving an address, and after
 * every successful drop-recovery probe. The wsStatus guard means it only
 * sends on the current, open socket; otherwise the on-open snapshot or the
 * next connect/check covers the fetch. Never throws.
 */
export function requestSnapshot(): void {
    if (state.wsStatus !== 'connected' || !socket || !currentHost) return;
    sendSnapshot(socket, currentHost);
}

/** Startup sequence for a saved address: mark the check, connect the socket,
 * probe reachability, and re-request the state snapshot when the check succeeds. */
export function checkSoundtouchOnStartup(savedAddress: string): void {
    state.soundtouchStatus = 'checking';
    connectSoundtouchWs(savedAddress);
    pingSoundtouch(savedAddress).then(ok => {
        if (state.soundtouchAddress === savedAddress) {
            state.soundtouchStatus = ok ? 'available' : 'unreachable';
            if (!ok) cancelSendConfirmation();
            render();
            if (ok) requestSnapshot();
        }
    });
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
    if (!root) return;
    if (root.tagName === 'updates') {
        handleUpdates(root);
    } else if (root.tagName === 'msg') {
        handleResponse(root);
    }
}

function handleUpdates(root: Element): void {
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
            root.ownerDocument.querySelector('nowPlaying')?.getAttribute('deviceID');
        if (deviceId) {
            state.soundtouchDevice = {...(state.soundtouchDevice ?? {}), id: deviceId};
            changed = true;
        }
    }

    if (nowPlayingUpdated) {
        if (applyNowPlaying(nowPlayingUpdated.querySelector('nowPlaying'))) {
            changed = true;
            evaluateNowPlaying();
        }
    }

    if (applyVolume(volumeWithData)) changed = true;

    if (changed) render();
}

/**
 * Shared defensive now-playing field mapping; true when the element exists.
 * Stores the raw verbose payload (FR-3 extension) as-is — missing elements
 * stay empty and fallback chaining (title/artist/art) belongs to the
 * components, never here.
 */
function applyNowPlaying(np: Element | null): boolean {
    if (!np) return false;
    state.deviceNowPlaying = np.querySelector('track')?.textContent?.trim() ?? '';
    state.deviceArtist = np.querySelector('artist')?.textContent?.trim() ?? '';
    state.deviceAlbum = np.querySelector('album')?.textContent?.trim() ?? '';
    state.deviceSource = np.getAttribute('source') ?? '';
    const playStatus = np.querySelector('playStatus')?.textContent?.trim() ?? '';
    state.devicePlayStatus = PLAY_STATUSES.includes(playStatus) ? playStatus : '';
    const art = np.querySelector('art');
    const contentItem = np.querySelector('ContentItem');
    const time = np.querySelector('time');
    const timeTotalRaw = time?.getAttribute('total');
    const timeTotal = timeTotalRaw === undefined || timeTotalRaw === null || Number.isNaN(Number(timeTotalRaw)) ? null : Number(timeTotalRaw);
    state.deviceNowPlayingDetail = {
        stationName: np.querySelector('stationName')?.textContent?.trim() ?? '',
        art: art?.textContent?.trim() ?? '',
        artImageStatus: art?.getAttribute('artImageStatus') ?? '',
        contentItem: contentItem ? {
            source: contentItem.getAttribute('source') ?? '',
            type: contentItem.getAttribute('type') ?? '',
            location: contentItem.getAttribute('location') ?? '',
            sourceAccount: contentItem.getAttribute('sourceAccount') ?? '',
            itemName: contentItem.querySelector('itemName')?.textContent?.trim() ?? '',
            containerArt: contentItem.querySelector('containerArt')?.textContent?.trim() ?? '',
        } : null,
        sourceAccount: np.getAttribute('sourceAccount') ?? '',
        timeTotal,
        timePosition: time?.textContent?.trim() ?? '',
        // presence elements: present = enabled, absent = disabled
        skipEnabled: !!np.querySelector('skipEnabled'),
        skipPreviousEnabled: !!np.querySelector('skipPreviousEnabled'),
        favoriteEnabled: !!np.querySelector('favoriteEnabled'),
        // seekSupported carries a value attribute, not chardata
        seekSupported: np.querySelector('seekSupported')?.getAttribute('value') === 'true',
        shuffleSetting: np.querySelector('shuffleSetting')?.textContent?.trim() ?? '',
        repeatSetting: np.querySelector('repeatSetting')?.textContent?.trim() ?? '',
        streamType: np.querySelector('streamType')?.textContent?.trim() ?? '',
        trackId: np.querySelector('trackID')?.textContent?.trim() ?? '',
        position: np.querySelector('position')?.textContent?.trim() ?? '',
        description: np.querySelector('description')?.textContent?.trim() ?? '',
        stationLocation: np.querySelector('stationLocation')?.textContent?.trim() ?? '',
    };
    return true;
}

/**
 * Shared defensive device-info mapping (FR-3 extension); true when the info
 * element exists. The <info> element's own deviceID attribute wins over the
 * RESPONSE header's; the header (or a previously known id) is the fallback,
 * and with neither the id is an empty string.
 */
function applyInfo(info: Element | null, headerId: string): boolean {
    if (!info) return false;
    const id = info.getAttribute('deviceID') ?? headerId ?? state.soundtouchDevice?.id ?? '';
    const name = info.querySelector('name')?.textContent?.trim() || undefined;
    const type = info.querySelector('type')?.textContent?.trim() || undefined;
    const moduleType = info.querySelector('moduleType')?.textContent?.trim() || undefined;
    const variant = info.querySelector('variant')?.textContent?.trim() || undefined;
    const variantMode = info.querySelector('variantMode')?.textContent?.trim() || undefined;
    const countryCode = info.querySelector('countryCode')?.textContent?.trim() || undefined;
    const regionCode = info.querySelector('regionCode')?.textContent?.trim() || undefined;
    const networkInfo = info.querySelector('networkInfo');
    const networkType = networkInfo?.getAttribute('type') || undefined;
    const ipAddress = networkInfo?.querySelector('ipAddress')?.textContent?.trim() || undefined;
    const component = info.querySelector('components > component');
    const componentCategory = component?.querySelector('componentCategory')?.textContent?.trim() || undefined;
    const softwareVersion = component?.querySelector('softwareVersion')?.textContent?.trim() || undefined;
    const margeUrl = info.querySelector('margeURL')?.textContent?.trim() || undefined;
    const margeAccountUuid = info.querySelector('margeAccountUUID')?.textContent?.trim() || undefined;
    // conditional spread: rows render only for the fields that exist, and the
    // existing `{id}` / `{id,name,type}` shapes keep passing unchanged
    state.soundtouchDevice = {
        id,
        ...(name ? {name} : {}),
        ...(type ? {type} : {}),
        ...(moduleType ? {moduleType} : {}),
        ...(variant ? {variant} : {}),
        ...(variantMode ? {variantMode} : {}),
        ...(countryCode ? {countryCode} : {}),
        ...(regionCode ? {regionCode} : {}),
        ...(networkType ? {networkType} : {}),
        ...(ipAddress ? {ipAddress} : {}),
        ...(componentCategory ? {componentCategory} : {}),
        ...(softwareVersion ? {softwareVersion} : {}),
        ...(margeUrl ? {margeUrl} : {}),
        ...(margeAccountUuid ? {margeAccountUuid} : {})
    };
    return true;
}

/** Shared defensive volume/mute mapping; true if any field was applied. */
function applyVolume(v: Element | null): boolean {
    if (!v) return false;
    let changed = false;
    const actual = Number(v.querySelector('actualvolume')?.textContent);
    const target = Number(v.querySelector('targetvolume')?.textContent);
    if (!Number.isNaN(actual)) {
        state.deviceVolume = actual;
        changed = true;
    } else if (!Number.isNaN(target)) {
        state.deviceVolume = target;
        changed = true;
    }
    const mute = v.querySelector('muteenabled')?.textContent;
    if (mute === 'true' || mute === 'false') {
        state.deviceMute = mute === 'true';
        changed = true;
    }
    return changed;
}

function handleResponse(root: Element): void {
    const header = root.querySelector('header');
    if (!header || ![header.getAttribute('msgType'), root.querySelector('request')?.getAttribute('msgType')].includes('RESPONSE')) return;
    const body = root.querySelector('body');
    if (!body) return;
    const nowPlaying = body.querySelector('nowPlaying');
    const volume = body.querySelector('volume');
    const info = body.querySelector('info');
    if (!nowPlaying && !volume && !info) return;

    let changed = false;

    const headerId = header.getAttribute('deviceID') ?? '';
    if (headerId) {
        state.soundtouchDevice = {...(state.soundtouchDevice ?? {}), id: headerId};
        changed = true;
    }

    if (applyNowPlaying(nowPlaying)) {
        changed = true;
        evaluateNowPlaying();
    }
    if (applyVolume(volume)) changed = true;
    // applyInfo overrides the header id with the <info> element's own
    // deviceID attribute when both are present (the pinned precedence)
    if (applyInfo(info, headerId)) changed = true;

    if (changed) render();
}
