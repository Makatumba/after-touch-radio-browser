import type {State, Station} from '../state';
import {isFavorite} from '../actions';

export function renderStationCard(station: Station, state: State, t: Record<string, string>): string {
    const active = state.stations[state.currentIndex]?.stationuuid === station.stationuuid;
    const playBtn = `<button class="btn btn-primary" data-play="${station.stationuuid}">${t.play}</button>`;
    return `<article class="station-card ${active ? 'active' : ''}"><div class="station-name">${station.name}</div><div class="station-badges"><span class="badge ${station.lastcheckok ? 'live' : ''}">${station.lastcheckok ? 'Reachable' : 'Unchecked / broken'}</span>${station.country ? `<span class="badge">${station.country}</span>` : ''}${station.language ? `<span class="badge">${station.language}</span>` : ''}</div><div class="station-actions">${playBtn}<button class="btn btn-secondary" data-fav="${station.stationuuid}">${isFavorite(station.stationuuid, state) ? t.remove : t.favorite}</button><button class="btn btn-secondary" data-send="${station.stationuuid}">${t.send}</button></div></article>`;
}
