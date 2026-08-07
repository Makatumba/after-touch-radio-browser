import type {Language} from './i18n';
import {detectLanguage, getLabels, getLocale, SORT_LABEL_KEYS, translations} from './i18n';
import type {Mode, Settings, SortKey, State, Station, FilterOption} from './state';
import {getAudioElement} from './player';
import {topStations, recentStations, searchStations, fetchLanguages, fetchCountries} from './api';
import {loadSettings} from './settings';
import {loadFilterCache, saveFilterCache} from './filter-cache';
import type {FilterCacheKind} from './filter-cache';
import {scanArtwork, setRenderHook} from './artwork';
import {compareFavorites} from './actions';
import {renderHeader} from './components/header';
import {renderRemotePanel} from './components/remote';
import {renderSetup} from './components/setup';
import {renderOfflineBanner, renderServiceBanner} from './components/banner';
import {renderFilters} from './components/filters';
import {renderFooter} from './components/footer';
import {renderStationCard} from './components/station-card';
import {renderPlayerBar} from './components/player-bar';

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
    sort: 'votes',
    mode: 'top',
    stations: [],
    offset: 0,
    favorites: JSON.parse(localStorage.getItem(LS_FAVORITES) || '[]') as Station[],
    nowPlaying: 'No station playing',
    playerMeta: 'Pick a station to start streaming.',
    status: 'Idle',
    soundtouchAddress: localStorage.getItem(LS_SOUNDTOUCH) || '',
    soundtouchStatus: 'idle',
    serviceUnavailable: false,
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

/** Wave 7: after render() re-inserts the preserved settings popup, the popup
 * module re-syncs its SoundTouch section in place (status, hints, device info)
 * with the freshest state — the popup node itself keeps its identity and never
 * replays its entrance animation (no-blink contract). Registered once by
 * settings-modal.ts at module load; null until then makes the hook a no-op. */
let modalSyncHook: (() => void) | null = null;
export function setModalSyncHook(fn: (() => void) | null): void {
    modalSyncHook = fn;
}

function App() {
    const t = getLabels(state);
    if (!state.soundtouchAddress && !state.skippedSetup) return renderSetup(state, t);
    const playerHtml = state.settings.enablePreview ? renderPlayerBar(state, t) : '';
    const bannerHtml = `${state.soundtouchStatus === 'unreachable' ? renderOfflineBanner(state, t) : ''}${state.serviceUnavailable ? renderServiceBanner(state, t) : ''}`;
    const prevDisabled = state.offset === 0 ? ' disabled' : '';
    const nextDisabled = state.stations.length < state.limit ? ' disabled' : '';
    return `<div class="app-shell">
    <a class="skip-link" href="#main">Skip to content</a>
    ${renderHeader(t)}
    <main id="main">
        ${bannerHtml}
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
                    ${renderStationList(state, t)}
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
</div>`;
}

/** The station-list content: cards in the current language, or the empty
 * state — extracted so the language-switch path can re-render it into the
 * preserved list node. */
function renderStationList(state: State, t: Record<string, string>): string {
    return state.stations.length
        ? state.stations.map(s => renderStationCard(s, state, t)).join('')
        : `<div class="empty-state"><strong>${t.noResults}</strong></div>`;
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
        state.serviceUnavailable = false;
        state.currentIndex = state.stations.length ? 0 : -1;
    } catch (e) {
        console.error(e);
        state.stations = [];
        state.serviceUnavailable = true;
        state.status = t.serviceUnavailable;
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
    // Wave 5: the settings popup is mounted explicitly (settings-modal.ts);
    // detach it before the shell re-render and re-insert the same node so a
    // background render neither rebuilds it nor replays its entrance
    // animation (no-blink contract).
    const modal = document.querySelector<HTMLElement>('.modal-overlay');
    if (modal) modal.remove();

    document.querySelector<HTMLDivElement>('#app')!.innerHTML = App();

    if (state.settings.enablePreview) {
        const section = document.querySelector<HTMLElement>('.player');
        if (section) section.appendChild(audio);
    }
    if (state.showSettings && modal) {
        modal.classList.add('modal-overlay--no-anim');
        document.querySelector<HTMLDivElement>('#app')!.appendChild(modal);
        // wave 7: the preserved popup's SoundTouch section re-syncs in place
        // so a background render keeps the live status/hints current.
        modalSyncHook?.();
    }

    // kick off background artwork fetches for any skeleton slots; requestArtwork
    // is idempotent, so re-scanning settled/in-flight slots is a no-op
    scanArtwork();
}

/** Wave 5: toggling preview on/off (or resetting) must change only the
 * in-browser player bar — never rebuild the shell behind the open settings
 * popup (no-blink contract). Mirrors render()'s audio re-attachment for the
 * surgical path: the persistent <audio> stays inside the bar while preview
 * is on and stays alive (detached) when the bar is removed. */
export function syncPlayerBar(): void {
    const player = document.querySelector<HTMLElement>('.player');
    if (state.settings.enablePreview) {
        if (player) return;
        const main = document.querySelector<HTMLElement>('main#main');
        if (!main) return;
        main.insertAdjacentHTML('beforeend', renderPlayerBar(state, getLabels(state)));
        document.querySelector<HTMLElement>('.player')?.appendChild(getAudioElement());
    } else if (player) {
        player.remove();
    }
}

/** Wave 6: a language change must re-label the whole shell while preserving
 * the station-list node and the open settings popup (no-blink contract). The
 * shell re-renders through render() (which re-inserts the preserved popup;
 * the caller re-labels it in place), while the captured station-list node is
 * re-labeled in place and swapped back in — the list is never rebuilt as a
 * node, so the popup's language row keeps working across rapid switches. */
export function syncShellLanguage(): void {
    const list = document.querySelector<HTMLElement>('.station-list');
    render();
    if (!list) return;
    list.innerHTML = renderStationList(state, getLabels(state));
    document.querySelector<HTMLElement>('.station-list')?.replaceWith(list);
    scanArtwork();
}

/** Wave 6: toggling skip-hiding (or resetting) must change only the Remote
 * panel — never rebuild the shell behind the open settings popup (no-blink
 * contract). Replaces ONLY the .remote-panel node; inserts it before the
 * layout when absent; then re-primes the panel's artwork slots. */
export function syncRemotePanel(): void {
    if (!state.soundtouchAddress) return;
    const main = document.querySelector<HTMLElement>('main#main');
    if (!main) return;
    const html = renderRemotePanel(state, getLabels(state));
    const panel = document.querySelector<HTMLElement>('.remote-panel');
    if (panel) {
        panel.outerHTML = html;
    } else {
        const layout = document.querySelector<HTMLElement>('.layout');
        if (layout) layout.insertAdjacentHTML('beforebegin', html);
        else main.insertAdjacentHTML('afterbegin', html);
    }
    scanArtwork();
}

/** Wave 6: toggling the in-browser preview (or resetting it) must also show
 * or hide the station cards' preview buttons — the player bar alone is not
 * the whole preview UI. Re-renders only the .station-list children in place:
 * the list node and the open popup keep their identity (no-blink contract). */
export function syncStationCards(): void {
    const list = document.querySelector<HTMLElement>('.station-list');
    if (!list) return;
    list.innerHTML = renderStationList(state, getLabels(state));
    scanArtwork();
}

// artwork settle → re-render once, wired a single time at module load (the
// hook's render() re-scan is a no-op for settled URLs, so no loop)
setRenderHook(render);

export function searchFromInputs() {
    state.query = document.querySelector<HTMLInputElement>('#query')?.value || '';
    state.countryCode = document.querySelector<HTMLSelectElement>('#country')?.value || '';
    state.langFilter = document.querySelector<HTMLSelectElement>('#languageFilter')?.value || '';
    state.tag = document.querySelector<HTMLInputElement>('#tag')?.value || '';
    state.limit = Number(document.querySelector<HTMLSelectElement>('#limit')?.value || 24);
    state.hideBroken = !!document.querySelector<HTMLInputElement>('#hideBroken')?.checked;
    state.sort = (document.querySelector<HTMLSelectElement>('#sort')?.value as SortKey) || 'votes';
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
    state.sort = 'votes';
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
