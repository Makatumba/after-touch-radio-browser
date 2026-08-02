import axios from 'axios';
import type {FilterOption, Station} from './state';

const api = axios.create({baseURL: 'https://de1.api.radio-browser.info/json'});

export async function searchStations(params: {
    name?: string;
    countryCode?: string;
    language?: string;
    tag?: string;
    limit: number;
    hideBroken: boolean;
    offset?: number;
}): Promise<Station[]> {
    const {data} = await api.get('/stations/search', {
        params: {
            limit: params.limit,
            hidebroken: params.hideBroken,
            order: 'clickcount',
            reverse: true, ...(params.offset != null ? {offset: params.offset} : {}), ...(params.name ? {name: params.name} : {}), ...(params.countryCode ? {countrycode: params.countryCode} : {}), ...(params.language ? {language: params.language, languageExact: true} : {}), ...(params.tag ? {tag: params.tag} : {})
        }
    });
    return data;
}

export async function topStations(limit: number, hideBroken: boolean, offset = 0): Promise<Station[]> {
    const {data} = await api.get('/stations/topvote', {params: {limit, hidebroken: hideBroken, offset}});
    return data;
}

export async function recentStations(limit: number, hideBroken: boolean, offset = 0): Promise<Station[]> {
    const {data} = await api.get('/stations/lastclick', {params: {limit, hidebroken: hideBroken, offset}});
    return data;
}

interface LanguageEntry {
    name: string;
    iso_639: string | null;
    stationcount: number;
}

interface CountryEntry {
    name: string;
    iso_3166_1: string;
    stationcount: number;
}

export async function fetchLanguages(): Promise<FilterOption[]> {
    const {data} = await api.get<LanguageEntry[]>('/languages', {params: {hidebroken: true, order: 'stationcount', reverse: true}});
    return data
        .filter((l): l is LanguageEntry & { iso_639: string } => l.iso_639 !== null)
        .map(l => ({value: l.name, label: l.name, code: l.iso_639}))
        .sort((a, b) => a.label.localeCompare(b.label));
}

export async function fetchCountries(): Promise<FilterOption[]> {
    const {data} = await api.get<CountryEntry[]>('/countries', {params: {hidebroken: true, order: 'stationcount', reverse: true}});
    return data
        .map(c => ({value: c.iso_3166_1, label: c.name, code: c.iso_3166_1}))
        .sort((a, b) => a.label.localeCompare(b.label));
}
