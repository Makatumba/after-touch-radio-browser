import type {Language} from './i18n';
import {detectLanguage, getLabels, translations} from './i18n';
import type {Mode, Settings, State, Station} from './state';
import {getAudioElement} from './player';
import {topStations, recentStations, searchStations} from './api';
import {playStation} from './actions';
import {loadSettings} from './settings';
import {renderHeader} from './components/header';
import {renderSoundtouch} from './components/soundtouch';
import {renderSetup} from './components/setup';
import {renderOfflineBanner} from './components/banner';
import {renderFilters} from './components/filters';
import {renderFooter} from './components/footer';
import {renderStationCard} from './components/station-card';
import {renderPlayerBar} from './components/player-bar';
import {renderSettings} from './components/settings';

const LS_LANGUAGE = 'radio-browser-language';
const LS_SOUNDTOUCH = 'radio-browser-soundtouch-host';
const LS_FAVORITES = 'radio-browser-favorites';

export function initLanguage(): Language {
    const saved = localStorage.getItem(LS_LANGUAGE) as Language | null;
    if (saved) return saved;
    const detected = detectLanguage(navigator.language);
    localStorage.setItem(LS_LANGUAGE, detected);
    return detected;
}

export const state: State = {
    language: (localStorage.getItem(LS_LANGUAGE) as Language) || 'en',
    query: '',
    country: '',
    langFilter: '',
    tag: '',
    limit: 24,
    hideBroken: true,
    mode: 'top',
    stations: [],
    favorites: JSON.parse(localStorage.getItem(LS_FAVORITES) || '[]') as Station[],
    nowPlaying: 'No station playing',
    playerMeta: 'Pick a station to start streaming.',
    status: 'Idle',
    soundtouchAddress: localStorage.getItem(LS_SOUNDTOUCH) || '',
    soundtouchStatus: 'idle',
    currentIndex: -1,
    showSettings: false,
    skippedSetup: false,
    deviceMessage: '',
    settings: loadSettings()
};

function App() {
    const t = getLabels(state);
    if (!state.soundtouchAddress && !state.skippedSetup) return renderSetup(state, t);
    const playerHtml = state.settings.enablePreview ? renderPlayerBar(state, t) : '';
    const settingsHtml = state.showSettings ? renderSettings(state) : '';
    const bannerHtml = state.soundtouchStatus === 'unreachable' ? renderOfflineBanner(state, t) : '';
    return `<div class="app-shell"><a class="skip-link" href="#main">Skip to content</a>${renderHeader(state, t)}<main id="main">${bannerHtml}${renderSoundtouch(state, t)}<section class="layout">${renderFilters(state, t)}<section class="panel results-panel"><div class="toolbar"><div><h2>${state.mode === 'favorites' ? t.favorites : state.mode === 'recent' ? t.recent : state.mode === 'top' ? t.top : t.searchResults}</h2><small>${state.status}</small></div><button class="pill-btn" id="refresh">↻</button></div><div class="station-list">${state.stations.length ? state.stations.map(s => renderStationCard(s, state, t)).join('') : `<div class="empty-state"><strong>${t.noResults}</strong></div>`}</div><div class="results-footer"><button class="btn btn-secondary" id="prevResults">${t.previousSet}</button><button class="btn btn-secondary" id="nextResults">${t.nextSet}</button></div></section></section>${playerHtml}</main>${renderFooter(state, t)}${settingsHtml}</div>`;
}

export async function refresh(mode: Mode = state.mode) {
    const t = getLabels(state);
    state.mode = mode;
    state.status = t.loading;
    try {
        state.stations = mode === 'favorites' ? state.favorites : mode === 'top' ? await topStations(state.limit, state.hideBroken) : mode === 'recent' ? await recentStations(state.limit, state.hideBroken) : await searchStations({
            name: state.query,
            country: state.country,
            language: state.langFilter,
            tag: state.tag,
            limit: state.limit,
            hideBroken: state.hideBroken
        });
        state.status = `${state.stations.length} loaded`;
        state.currentIndex = state.stations.length ? 0 : -1;
    } catch (e) {
        console.error(e);
        state.stations = [];
        state.status = 'Service unavailable';
        state.currentIndex = -1;
    }
    render();
}

export function render() {
    const audio = getAudioElement();
    if (audio.parentElement) audio.remove();

    document.querySelector<HTMLDivElement>('#app')!.innerHTML = App();

    if (state.settings.enablePreview) {
        const section = document.querySelector<HTMLElement>('.player');
        if (section) section.appendChild(audio);
    }
}

export function searchFromInputs() {
    state.query = document.querySelector<HTMLInputElement>('#query')?.value || '';
    state.country = document.querySelector<HTMLInputElement>('#country')?.value || '';
    state.langFilter = document.querySelector<HTMLInputElement>('#languageFilter')?.value || '';
    state.tag = document.querySelector<HTMLInputElement>('#tag')?.value || '';
    state.limit = Number(document.querySelector<HTMLSelectElement>('#limit')?.value || 24);
    state.hideBroken = !!document.querySelector<HTMLInputElement>('#hideBroken')?.checked;
    refresh('search');
}

export function reset() {
    state.query = '';
    state.country = '';
    state.langFilter = '';
    state.tag = '';
    state.limit = 24;
    state.hideBroken = true;
    refresh('top');
}

export async function loadNextResultSet() {
    const next = state.mode === 'top' ? 'recent' : state.mode === 'recent' ? 'search' : state.mode === 'search' ? 'favorites' : 'top';
    if (next === 'search') state.limit = Math.min(100, state.limit + 24);
    await refresh(next as Mode);
}

export async function loadPreviousResultSet() {
    const prev = state.mode === 'favorites' ? 'search' : state.mode === 'search' ? 'recent' : state.mode === 'recent' ? 'top' : 'favorites';
    if (prev === 'search') state.limit = Math.max(12, state.limit - 24);
    await refresh(prev as Mode);
}

export {App};
