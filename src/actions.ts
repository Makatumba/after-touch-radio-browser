import type {SortKey, State, Station} from './state';
import type {Language} from './i18n';
import {getLabels, getLocale} from './i18n';
import {playStream, stopStream} from './player';
import {state} from './app';
import {cancelSendConfirmation} from './confirmation';
import {loadArtworkCache, rememberStationArtwork} from './artwork';

const PING_TIMEOUT_MS = 5000;
const VOLUME_DEBOUNCE_MS = 400;

function escapeXml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const REMOTE_KEYS = {
    play: 'PLAY',
    pause: 'PAUSE',
    next: 'NEXT_TRACK',
    prev: 'PREV_TRACK',
    power: 'POWER'
} as const;

export function compareFavorites(a: Station, b: Station, sort: SortKey, locale: string): number {
    if (sort === 'name_asc') return (a.name || '').localeCompare(b.name || '', locale);
    if (sort === 'name_desc') return -(a.name || '').localeCompare(b.name || '', locale);
    return (b[sort] ?? 0) - (a[sort] ?? 0);
}

export function sanitizeHost(raw: string): string {
    let host = raw.trim();
    host = host.replace(/^https?:\/\//i, '');
    const cut = host.search(/[/?#]/);
    if (cut !== -1) host = host.slice(0, cut);
    host = host.replace(/\/+$/, '');
    if (/[^A-Za-z0-9._:\-]/.test(host)) return '';
    return host;
}

export function soundtouchBaseUrl(raw: string): string {
    const clean = sanitizeHost(raw);
    if (!clean) return '';
    const httpOrHttps = raw.startsWith('https') ? 'https' : 'http';
    return `${httpOrHttps}://${clean}${/:\d+$/.test(clean) ? '' : ':8090'}`;
}

export function soundtouchWsUrl(raw: string): string {
    const clean = sanitizeHost(raw);
    if (!clean) return '';
    return `ws://${clean}${/:\d+$/.test(clean) ? '' : ':8080'}/`;
}

export async function sendKeyPress(key: string): Promise<void> {
    const host = sanitizeHost(state.soundtouchAddress);
    if (!host) return;
    const init: RequestInit = {
        method: 'POST',
        mode: 'no-cors',
        headers: {'Content-Type': 'text/plain;charset=UTF-8'}
    };
    await fetch(`${soundtouchBaseUrl(host)}/key`, {...init, body: `<key state="press" sender="Gabbo">${key}</key>`});
    await fetch(`${soundtouchBaseUrl(host)}/key`, {...init, body: `<key state="release" sender="Gabbo">${key}</key>`});
}

export async function sendVolume(value: number): Promise<void> {
    const host = sanitizeHost(state.soundtouchAddress);
    if (!host) return;
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    await fetch(`${soundtouchBaseUrl(host)}/volume`, {
        method: 'POST',
        mode: 'no-cors',
        headers: {'Content-Type': 'text/plain;charset=UTF-8'},
        body: `<volume>${clamped}</volume>`
    });
}

export async function sendMute(muted: boolean): Promise<void> {
    const host = sanitizeHost(state.soundtouchAddress);
    if (!host) return;
    await fetch(`${soundtouchBaseUrl(host)}/volume`, {
        method: 'POST',
        mode: 'no-cors',
        headers: {'Content-Type': 'text/plain;charset=UTF-8'},
        body: `<volume><muteenabled>${muted ? 'true' : 'false'}</muteenabled></volume>`
    });
}

let volumeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingVolumeHost = '';

export function scheduleVolumeSend(value: number): void {
    const host = sanitizeHost(state.soundtouchAddress);
    if (!host) return;
    if (volumeTimer !== null) clearTimeout(volumeTimer);
    pendingVolumeHost = host;
    volumeTimer = setTimeout(() => {
        volumeTimer = null;
        // stale-host guard: the address may have changed while the timer was pending
        if (sanitizeHost(state.soundtouchAddress) !== pendingVolumeHost) return;
        sendVolume(value);
    }, VOLUME_DEBOUNCE_MS);
}

export function playStation(station: Station, state: State) {
    const url = station.url_resolved || station.url;
    if (!url) return;
    state.nowPlaying = station.name || 'Unnamed station';
    state.playerMeta = [station.country, station.language, station.codec, station.bitrate ? `${station.bitrate} kbps` : ''].filter(Boolean).join(' · ');
    state.currentIndex = Math.max(0, state.stations.findIndex(s => s.stationuuid === station.stationuuid));
    playStream(url);
}

export function stopPlayback(state: State) {
    stopStream();
    const t = getLabels(state);
    state.nowPlaying = t.playbackStopped;
    state.playerMeta = t.playbackStoppedMeta;
}

export function toggleFavorite(station: Station, state: State) {
    const idx = state.favorites.findIndex(s => s.stationuuid === station.stationuuid);
    if (idx >= 0) {
        state.favorites.splice(idx, 1);
    } else {
        state.favorites.push(station);
    }
    localStorage.setItem('radio-browser-favorites', JSON.stringify(state.favorites));
}

export function isFavorite(uuid: string, state: State): boolean {
    return state.favorites.some(s => s.stationuuid === uuid);
}

export function setLanguage(lang: Language, state: State) {
    state.language = lang;
    localStorage.setItem('radio-browser-language', lang);
    document.documentElement.lang = getLocale(lang);
}

export async function pingSoundtouch(host: string): Promise<boolean> {
    const base = soundtouchBaseUrl(host);
    if (!base) return false;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    try {
        await fetch(`${base}/info`, {method: 'GET', mode: 'no-cors', signal: controller.signal});
        return true;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

export async function sendToSoundtouch(station: Station, state: State) {
    const host = sanitizeHost(state.soundtouchAddress);
    if (!host) return;
    const t = getLabels(state);
    // FR-6 artwork send-with-play: resolve from the station in hand (favicon →
    // per-station cache → none), never from the playing state; a known URL is
    // persisted and background-verified so the speaker's echoed logo stays valid.
    const itemName = station.name || '';
    const artUrl = station.favicon || loadArtworkCache(station.stationuuid) || '';
    if (artUrl) rememberStationArtwork(station.stationuuid, artUrl);
    // ContentItem children (<itemName>, <containerArt>) are included individually
    // only when known — 4-space indented, XML-escaped; omitting both keeps the
    // exact self-closed form (zero wire regression).
    let contentItem: string;
    if (itemName || artUrl) {
        contentItem = `<ContentItem source="RADIO_BROWSER" type="stationurl" location="/stations/byuuid/${station.stationuuid}">${itemName ? `
    <itemName>${escapeXml(itemName)}</itemName>` : ''}${artUrl ? `
    <containerArt>${escapeXml(artUrl)}</containerArt>` : ''}
</ContentItem>`;
    } else {
        contentItem = `<ContentItem source="RADIO_BROWSER" type="stationurl" location="/stations/byuuid/${station.stationuuid}"/>`;
    }
    try {
        await fetch(`${soundtouchBaseUrl(host)}/select`, {
            method: 'POST',
            mode: 'no-cors',
            headers: {'Content-Type': 'text/plain;charset=UTF-8'},
            body: contentItem
        });
        if (state.soundtouchAddress === host) {
            state.soundtouchStatus = 'available';
        }
    } catch {
        if (state.soundtouchAddress === host) {
            state.soundtouchStatus = 'unreachable';
            // drop any prior pending send before the failure message wins
            cancelSendConfirmation(true);
            state.deviceMessage = t.sendFailed;
        }
    }
}
