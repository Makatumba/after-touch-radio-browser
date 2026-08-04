import type {Language} from './i18n';
import {detectLanguage, getLabels, getLocale, SORT_LABEL_KEYS, translations} from './i18n';
import type {Mode, Settings, SortKey, State, Station, FilterOption} from './state';
import {getAudioElement} from './player';
import {topStations, recentStations, searchStations, fetchLanguages, fetchCountries} from './api';
import {loadSettings} from './settings';
import {loadFilterCache, saveFilterCache} from './filter-cache';
import type {FilterCacheKind} from './filter-cache';
import {compareFavorites} from './actions';
import {renderHeader} from './components/header';
import {renderSoundtouch} from './components/soundtouch';
import {renderRemotePanel} from './components/remote';
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
    language: initLanguage(),
    query: '',
    countryCode: '',
    langFilter: '',
    languages: [],
    countries: [],
    tag: '',
    limit: 24,
    hideBroken: true,
    sort: 'clickcount',
    mode: 'top',
    stations: [],
    offset: 0,
    favorites: JSON.parse(localStorage.getItem(LS_FAVORITES) || '[]') as Station[],
    nowPlaying: 'No station playing',
    playerMeta: 'Pick a station to start streaming.',
    status: 'Idle',
    soundtouchAddress: localStorage.getItem(LS_SOUNDTOUCH) || '',
    soundtouchStatus: 'idle',
    wsStatus: 'idle',
    deviceNowPlaying: '',
    deviceArtist: '',
    deviceAlbum: '',
    deviceSource: '',
    devicePlayStatus: '',
    deviceVolume: 0,
    deviceMute: false,
    deviceNowPlayingDetail: null,
    soundtouchDevice: null,
    currentIndex: -1,
    showSettings: false,
    skippedSetup: false,
    deviceMessage: '',
    settings: loadSettings()
};

/** Maps the five sort options onto the API's `order`/`reverse` parameters (see API-NOTES.md). */
export const SORT_API_PARAMS: Record<SortKey, { order: string; reverse?: boolean }> = {
    name_asc: { order: 'name' },
    name_desc: { order: 'name', reverse: true },
    clickcount: { order: 'clickcount', reverse: true },
    clicktrend: { order: 'clicktrend', reverse: true },
    votes: { order: 'votes', reverse: true },
};

function App() {
    const t = getLabels(state);
    if (!state.soundtouchAddress && !state.skippedSetup) return renderSetup(state, t);
    const playerHtml = state.settings.enablePreview ? renderPlayerBar(state, t) : '';
    const settingsHtml = state.showSettings ? renderSettings(state) : '';
    const bannerHtml = state.soundtouchStatus === 'unreachable' ? renderOfflineBanner(state, t) : '';
    const prevDisabled = state.offset === 0 ? ' disabled' : '';
    const nextDisabled = state.stations.length < state.limit ? ' disabled' : '';
    return `<div class="app-shell">
    <a class="skip-link" href="#main">Skip to content</a>
    ${renderHeader(state, t)}
    <main id="main">
        ${bannerHtml}
        ${renderSoundtouch(state, t)}
        ${state.soundtouchAddress ? renderRemotePanel(state, t) : ''}
        <section class="layout">
            ${renderFilters(state, t)}
            <section class="panel results-panel">
                <div class="toolbar">
                    <div>
                        <h2>${state.mode === 'favorites' ? t.favorites : state.mode === 'recent' ? t.recent : state.mode === 'top' ? t.top : t.searchResults}</h2>
                        <small>${state.status}</small>
                    </div>
                    <button class="pill-btn" id="refresh">↻</button>
                </div>
                <div class="station-list">
                    ${state.stations.length ? state.stations.map(s => renderStationCard(s, state, t)).join('') : `<div class="empty-state"><strong>${t.noResults}</strong></div>`}
                </div>
                <div class="results-footer">
                    <button class="btn btn-secondary" id="prevResults"${prevDisabled}>${t.previousSet}</button>
                    <button class="btn btn-secondary" id="nextResults"${nextDisabled}>${t.nextSet}</button>
                </div>
            </section>
        </section>
        ${playerHtml}
    </main>
    ${renderFooter(state, t)}
    ${settingsHtml}
</div>`;
}

async function loadMode(mode: Mode) {
    const t = getLabels(state);
    state.mode = mode;
    state.status = t.loading;
    try {
        state.stations = mode === 'favorites' ? [...state.favorites].sort((x, y) => compareFavorites(x, y, state.sort, getLocale(state.language))).slice(state.offset, state.offset + state.limit) : mode === 'top' ? await topStations(state.limit, state.hideBroken, state.offset) : mode === 'recent' ? await recentStations(state.limit, state.hideBroken, state.offset) : await searchStations({
            name: state.query,
            countryCode: state.countryCode,
            language: state.langFilter,
            tag: state.tag,
            limit: state.limit,
            hideBroken: state.hideBroken,
            offset: state.offset,
            ...SORT_API_PARAMS[state.sort]
        });
        state.status = `${state.stations.length} loaded` + (mode === 'search' || mode === 'favorites' ? ` · ${t[SORT_LABEL_KEYS[state.sort]]}` : '');
        state.currentIndex = state.stations.length ? 0 : -1;
    } catch (e) {
        console.error(e);
        state.stations = [];
        state.status = 'Service unavailable';
        state.currentIndex = -1;
    }
    render();
}

export async function refresh(mode: Mode = state.mode) {
    state.offset = 0;
    await loadMode(mode);
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
    state.countryCode = document.querySelector<HTMLSelectElement>('#country')?.value || '';
    state.langFilter = document.querySelector<HTMLSelectElement>('#languageFilter')?.value || '';
    state.tag = document.querySelector<HTMLInputElement>('#tag')?.value || '';
    state.limit = Number(document.querySelector<HTMLSelectElement>('#limit')?.value || 24);
    state.hideBroken = !!document.querySelector<HTMLInputElement>('#hideBroken')?.checked;
    state.sort = (document.querySelector<HTMLSelectElement>('#sort')?.value as SortKey) || 'clickcount';
    refresh('search');
}

/**
 * Fetches one filter option list, persisting each successful non-empty result
 * raw to its cache key and falling back to the cached list on a failed or
 * empty fetch. Never rejects — that invariant lets the two lists load
 * independently (a failure of one never discards the other).
 */
async function loadFilterList(kind: FilterCacheKind, fetcher: () => Promise<FilterOption[]>): Promise<FilterOption[]> {
    try {
        const options = await fetcher();
        if (options.length > 0) {
            saveFilterCache(kind, options);
            return options; // network stays authoritative
        }
    } catch (e) {
        console.error(e); // keep existing logging behavior
    }
    return loadFilterCache(kind) ?? []; // failed or empty fetch → cached fallback
}

export async function loadFilterOptions() {
    const [languages, countries] = await Promise.all([
        loadFilterList('languages', fetchLanguages),
        loadFilterList('countries', fetchCountries),
    ]);
    state.languages = languages;
    state.countries = countries;
    render();
}

export function reset() {
    state.query = '';
    state.countryCode = '';
    state.langFilter = '';
    state.tag = '';
    state.limit = 24;
    state.hideBroken = true;
    state.sort = 'clickcount';
    refresh('top');
}

export async function loadNextResultSet() {
    if (state.stations.length !== state.limit) return;
    state.offset += state.limit;
    await loadMode(state.mode);
}

export async function loadPreviousResultSet() {
    if (state.offset <= 0) return;
    state.offset = Math.max(0, state.offset - state.limit);
    await loadMode(state.mode);
}

export {App};
