import type {State, Station} from '../state';
import {isFavorite} from '../actions';

export function renderStationCard(station: Station, state: State, t: Record<string, string>): string {
    const active = state.stations[state.currentIndex]?.stationuuid === station.stationuuid;
    const disabled = !state.soundtouchAddress || state.soundtouchStatus === 'unreachable';
    const title = !state.soundtouchAddress ? t.unconfiguredHint : t.offlineHint;
    const playBtn = `<button class="btn btn-primary" data-play="${station.stationuuid}"${disabled ? ` disabled title="${title}"` : ''}>${t.playOnSpeaker}</button>`;
    const previewBtn = state.settings.enablePreview ? `<button class="btn btn-secondary" data-preview="${station.stationuuid}">${t.preview}</button>` : '';
    return `<article class="station-card ${active ? 'active' : ''}">
    <div class="station-name">${station.name}</div>
    <div class="station-badges">
        <span class="badge ${station.lastcheckok ? 'live' : ''}">${station.lastcheckok ? 'Reachable' : 'Unchecked / broken'}</span>
        ${station.country ? `<span class="badge">${station.country}</span>` : ''}
        ${station.language ? `<span class="badge">${station.language}</span>` : ''}
    </div>
    <div class="station-actions">
        ${playBtn}
        ${previewBtn}
        <button class="btn btn-secondary" data-fav="${station.stationuuid}">${isFavorite(station.stationuuid, state) ? t.remove : t.favorite}</button>
    </div>
</article>`;
}
