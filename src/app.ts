import type {Language} from './i18n';
import {translations} from './i18n';
import type {Mode, State, Station} from './state';
import {getAudioElement, playStream, stopStream} from './player';
import {recentStations, searchStations, topStations} from './api';

const LS_LANGUAGE = 'radio-browser-language';
const LS_SOUNDTOUCH = 'radio-browser-soundtouch-host';
const LS_FAVORITES = 'radio-browser-favorites';
const state: State = {
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
    currentIndex: -1
};

function labels() {
    const langKey = state.language === 'uk' ? 'ukr' : state.language;
    return (translations as Record<string, any>)[langKey] || translations.en;
}

function saveFavorites() {
    localStorage.setItem(LS_FAVORITES, JSON.stringify(state.favorites));
}

function setLanguage(lang: Language) {
    state.language = lang;
    localStorage.setItem(LS_LANGUAGE, lang);
    document.documentElement.lang = lang === 'ukr' ? 'uk' : lang;
}

function isFavorite(uuid: string) {
    return state.favorites.some(s => s.stationuuid === uuid);
}

function toggleFavorite(station: Station) {
    state.favorites = isFavorite(station.stationuuid) ? state.favorites.filter(s => s.stationuuid !== station.stationuuid) : [...state.favorites, station];
    saveFavorites();
}

async function play(station: Station) {
    const url = station.url_resolved || station.url;
    if (!url) return;
    state.nowPlaying = station.name || 'Unnamed station';
    state.playerMeta = [station.country, station.language, station.codec, station.bitrate ? `${station.bitrate} kbps` : 'Unknown bitrate'].filter(Boolean).join(' · ');
    state.currentIndex = Math.max(0, state.stations.findIndex(s => s.stationuuid === station.stationuuid));
    await playStream(url);
}

function stopPlayback() {
    stopStream();
    state.nowPlaying = t.playbackStopped;
    state.playerMeta = t.playbackStoppedMeta;
    render();
}

async function playCurrent() {
    const station = state.stations[state.currentIndex];
    if (station) await play(station);
}

async function nextStation() {
    if (!state.stations.length) return;
    state.currentIndex = (state.currentIndex + 1) % state.stations.length;
    await playCurrent();
}

async function previousStation() {
    if (!state.stations.length) return;
    state.currentIndex = (state.currentIndex - 1 + state.stations.length) % state.stations.length;
    await playCurrent();
}

async function loadNextResultSet() {
    const next = state.mode === 'top' ? 'recent' : state.mode === 'recent' ? 'search' : state.mode === 'search' ? 'favorites' : 'top';
    if (next === 'search') {
        state.limit = Math.min(100, state.limit + 24);
    }
    await refresh(next as Mode);
}

async function loadPreviousResultSet() {
    const prev = state.mode === 'favorites' ? 'search' : state.mode === 'search' ? 'recent' : state.mode === 'recent' ? 'top' : 'favorites';
    if (prev === 'search') {
        state.limit = Math.max(12, state.limit - 24);
    }
    await refresh(prev as Mode);
}

async function sendToSoundtouch(station: Station) {
    const host = state.soundtouchAddress.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!host) return;
    await fetch(`http://${host}:8090/select`, {
        method: 'POST',
        headers: {'Content-Type': 'text/plain;charset=UTF-8'},
        body: `<ContentItem source="RADIO_BROWSER" type="stationurl" location="/stations/byuuid/${station.stationuuid}"/>`
    });
}

async function refresh(mode: Mode = state.mode) {
    const t = labels();
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

function reset() {
    state.query = '';
    state.country = '';
    state.langFilter = '';
    state.tag = '';
    state.limit = 24;
    state.hideBroken = true;
    refresh('top');
}

function countries() {
    return Array.from(new Set(state.stations.map(s => s.country).filter(Boolean) as string[])).sort();
}

function languages() {
    return Array.from(new Set(state.stations.map(s => s.language).filter(Boolean) as string[])).sort();
}

function searchFromInputs() {
    state.query = document.querySelector<HTMLInputElement>('#query')?.value || '';
    state.country = document.querySelector<HTMLInputElement>('#country')?.value || '';
    state.langFilter = document.querySelector<HTMLInputElement>('#languageFilter')?.value || '';
    state.tag = document.querySelector<HTMLInputElement>('#tag')?.value || '';
    state.limit = Number(document.querySelector<HTMLSelectElement>('#limit')?.value || 24);
    state.hideBroken = !!document.querySelector<HTMLInputElement>('#hideBroken')?.checked;
    refresh('search');
}

function renderStation(station: Station) {
    const active = state.stations[state.currentIndex]?.stationuuid === station.stationuuid;
    return `<article class="station-card ${active ? 'active' : ''}"><div class="station-name">${station.name}</div><div class="station-badges"><span class="badge ${station.lastcheckok ? 'live' : ''}">${station.lastcheckok ? 'Reachable' : 'Unchecked / broken'}</span>${station.country ? `<span class="badge">${station.country}</span>` : ''}${station.language ? `<span class="badge">${station.language}</span>` : ''}</div><div class="station-actions"><button class="btn btn-primary" data-play="${station.stationuuid}">${translations[state.language].play}</button><button class="btn btn-secondary" data-fav="${station.stationuuid}">${isFavorite(station.stationuuid) ? translations[state.language].remove : translations[state.language].favorite}</button><button class="btn btn-secondary" data-send="${station.stationuuid}">${translations[state.language].send}</button></div></article>`;
}

function App() {
    const t = labels();
    return `<div class="app-shell"><a class="skip-link" href="#main">Skip to content</a><header class="topbar"><div class="brand"><div class="brand-mark"></div><div><h1>${t.title}</h1><p>${t.subtitle}</p></div></div><div class="lang-switcher-inline"><span>${t.active}: ${state.language}</span><div class="chips">${(['en', 'de', 'ru', 'ukr'] as Language[]).map(l => `<button class="chip ${state.language === l ? 'active' : ''}" data-lang="${l}">${l}</button>`).join('')}</div></div></header><main id="main"><section class="panel soundtouch-bar"><div class="soundtouch-collapsed"><span>${t.soundtouchCollapsed} ${state.soundtouchAddress ? `<span class="host-chip">${state.soundtouchAddress}</span>` : `<span class="host-chip empty">${t.soundtouch}</span>`}</span><button class="btn btn-secondary" id="toggleSoundtouch">${t.suggested}</button></div><div class="soundtouch-body collapsed" id="soundtouchBody"><div><h2>SoundTouch</h2><p>${t.enterSoundTouch}</p></div><div class="soundtouch-form"><input class="input" id="soundtouch" value="${state.soundtouchAddress}" /><button class="btn btn-secondary" id="saveSoundtouch">${t.save}</button></div><div class="suggested-icons"><button class="chip" type="button" aria-label="${t.suggestedUp}">⬆</button><button class="chip" type="button" aria-label="${t.suggestedDown}">⬇</button></div></div></section><section class="layout"><aside class="panel controls"><div class="field-group"><label class="field">${t.name}<input class="input" id="query" value="${state.query}"></label><label class="field">${t.country}<input class="input" id="country" value="${state.country}" placeholder="${t.allCountries}"></label><label class="field">${t.lang}<input class="input" id="languageFilter" value="${state.langFilter}" placeholder="${t.allLanguages}"></label><label class="field">${t.tag}<input class="input" id="tag" value="${state.tag}"></label><label class="field">${t.limit}<select class="select" id="limit">${[12, 24, 50, 100].map(n => `<option ${state.limit === n ? 'selected' : ''} value="${n}">${n}</option>`).join('')}</select></label><label class="checkbox-row"><input id="hideBroken" type="checkbox" ${state.hideBroken ? 'checked' : ''}/> ${t.hideBroken}</label></div><div class="actions"><button class="btn btn-primary" id="search">${t.search}</button><button class="btn btn-secondary" id="reset">${t.reset}</button></div><div class="chips"><button class="chip" data-mode="top">${t.top}</button><button class="chip" data-mode="recent">${t.recent}</button><button class="chip" data-mode="favorites">${t.favorites}</button></div></aside><section class="panel results-panel"><div class="toolbar"><div><h2>${state.mode === 'favorites' ? t.favorites : state.mode === 'recent' ? t.recent : state.mode === 'top' ? t.top : t.searchResults}</h2><small>${state.status}</small></div><button class="pill-btn" id="refresh">↻</button></div><div class="station-list">${state.stations.map(renderStation).join('') || `<div class="empty-state"><strong>${t.noResults}</strong></div>`}</div><div class="results-footer"><button class="btn btn-secondary" id="prevResults">${t.previousSet}</button><button class="btn btn-secondary" id="nextResults">${t.nextSet}</button></div></section></section><section class="panel player"><div class="player-top"><div><strong>${state.nowPlaying}</strong><small>${state.playerMeta}</small></div><div class="status">${state.status}</div></div><audio controls preload="none"></audio></section></main></div>`;
}

function bind() {
    document.querySelector('#saveSoundtouch')?.addEventListener('click', () => {
        state.soundtouchAddress = (document.querySelector<HTMLInputElement>('#soundtouch')?.value || '');
        localStorage.setItem(LS_SOUNDTOUCH, state.soundtouchAddress);
    });
    document.querySelector('#toggleSoundtouch')?.addEventListener('click', () => {
        const body = document.querySelector<HTMLElement>('#soundtouchBody');
        if (body) body.classList.toggle('collapsed');
    });
    document.querySelector('#query')?.addEventListener('keydown', e => {
        if ((e as KeyboardEvent).key === 'Enter') searchFromInputs();
    });
    document.querySelector('#country')?.addEventListener('keydown', e => {
        if ((e as KeyboardEvent).key === 'Enter') searchFromInputs();
    });
    document.querySelector('#languageFilter')?.addEventListener('keydown', e => {
        if ((e as KeyboardEvent).key === 'Enter') searchFromInputs();
    });
    document.querySelector('#tag')?.addEventListener('keydown', e => {
        if ((e as KeyboardEvent).key === 'Enter') searchFromInputs();
    });
    document.querySelector('#limit')?.addEventListener('change', searchFromInputs);
    document.querySelector('#hideBroken')?.addEventListener('change', searchFromInputs);
    document.querySelector('#search')?.addEventListener('click', searchFromInputs);
    document.querySelector('#reset')?.addEventListener('click', reset);
    document.querySelector('#refresh')?.addEventListener('click', () => refresh(state.mode));
    document.querySelector('#playCurrent')?.addEventListener('click', () => playCurrent().then(render));
    document.querySelector('#nextStation')?.addEventListener('click', () => nextStation().then(render));
    document.querySelector('#prevStation')?.addEventListener('click', () => previousStation().then(render));
    document.querySelector('#prevResults')?.addEventListener('click', () => loadPreviousResultSet());
    document.querySelector('#nextResults')?.addEventListener('click', () => loadNextResultSet());
    document.querySelector('#stopPlayback')?.addEventListener('click', () => stopPlayback());
    document.querySelector('#stopPlayerTop')?.addEventListener('click', () => stopPlayback());
    document.querySelector('#reloadAudio')?.addEventListener('click', () => {
        const widget = document.querySelector<HTMLAudioElement>('#audio-widget');
        const audio = getAudioElement();
        if (widget) {
            widget.src = audio.src;
            widget.load();
        }
    });
    document.querySelectorAll('[data-lang]').forEach(el => el.addEventListener('click', () => {
        setLanguage((el as HTMLElement).dataset.lang as Language);
        render();
    }));
    document.querySelectorAll('[data-mode]').forEach(el => el.addEventListener('click', () => refresh((el as HTMLElement).dataset.mode as Mode)));
    document.querySelectorAll('[data-play]').forEach(el => el.addEventListener('click', () => {
        const s = state.stations.find(x => x.stationuuid === (el as HTMLElement).dataset.play);
        if (s) play(s).then(render);
    }));
    document.querySelectorAll('[data-fav]').forEach(el => el.addEventListener('click', () => {
        const s = state.stations.find(x => x.stationuuid === (el as HTMLElement).dataset.fav);
        if (s) {
            toggleFavorite(s);
            render();
        }
    }));
    document.querySelectorAll('[data-send]').forEach(el => el.addEventListener('click', () => {
        const s = state.stations.find(x => x.stationuuid === (el as HTMLElement).dataset.send);
        if (s) sendToSoundtouch(s).catch(console.error);
    }));
}

export function render() {
    document.querySelector<HTMLDivElement>('#app')!.innerHTML = App();
    const audio = getAudioElement();
    const widget = document.querySelector<HTMLAudioElement>('#audio-widget');
    if (widget) {
        widget.src = audio.src || '';
        widget.load();
    }
    bind();
}

export {App, refresh, setLanguage, reset, state};
