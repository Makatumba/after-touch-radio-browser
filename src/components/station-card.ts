import type {State, Station} from '../state';
import {isFavorite} from '../actions';
import {renderArtworkSlot, resolveArtworkUrl} from '../artwork';

export function renderStationCard(station: Station, state: State, t: Record<string, string>): string {
    const active = state.stations[state.currentIndex]?.stationuuid === station.stationuuid;
    // wave 12: the toggle is the first gate — while off the off-hint wins over
    // both the unconfigured and the offline hint
    const speakerOn = !!state.soundtouchAddress && state.settings.enableSpeakerControl;
    const disabled = !speakerOn || state.soundtouchStatus === 'unreachable';
    const title = !state.settings.enableSpeakerControl
        ? t.speakerControlOffHint
        : !state.soundtouchAddress
            ? t.unconfiguredHint
            : t.offlineHint;
    const playBtn = `<button class="btn btn-primary" data-play="${station.stationuuid}"${disabled ? ` disabled title="${title}"` : ''}>${t.playOnSpeaker}</button>`;
    const previewBtn = state.settings.enablePreview ? `<button class="btn btn-secondary" data-preview="${station.stationuuid}">${t.preview}</button>` : '';
    return `<article class="station-card ${active ? 'active' : ''}">
    <div class="station-head">
        ${renderArtworkSlot(resolveArtworkUrl(station), station.stationuuid)}
        <div class="station-name">${station.name}</div>
    </div>
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
