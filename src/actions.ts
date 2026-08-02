import type {Station, State} from './state';
import {getLabels, getLocale} from './i18n';
import type {Language} from './i18n';
import {playStream, stopStream} from './player';

export function sanitizeHost(raw: string): string {
    let host = raw.trim();
    host = host.replace(/^https?:\/\//i, '');
    const cut = host.search(/[/?#]/);
    if (cut !== -1) host = host.slice(0, cut);
    host = host.replace(/\/+$/, '');
    if (/[^A-Za-z0-9._:\-]/.test(host)) return '';
    return host;
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
    const clean = sanitizeHost(host);
    if (!clean) return false;
    try {
        await fetch(`http://${clean}:8000/`, {method: 'HEAD', mode: 'no-cors'});
        return true;
    } catch {
        return false;
    }
}

export async function sendToSoundtouch(station: Station, state: State) {
    const host = sanitizeHost(state.soundtouchAddress);
    if (!host) return;
    const t = getLabels(state);
    try {
        await fetch(`http://${host}:8090/select`, {
            method: 'POST',
            mode: 'no-cors',
            headers: {'Content-Type': 'text/plain;charset=UTF-8'},
            body: `<ContentItem source="RADIO_BROWSER" type="stationurl" location="/stations/byuuid/${station.stationuuid}"/>`
        });
        if (state.soundtouchAddress === host) {
            state.soundtouchStatus = 'available';
            state.deviceMessage = t.playingOnSpeaker;
        }
    } catch {
        if (state.soundtouchAddress === host) {
            state.soundtouchStatus = 'unreachable';
            state.deviceMessage = t.sendFailed;
        }
    }
}
