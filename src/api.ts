import axios from 'axios';
import type {Station} from './state';

const api = axios.create({baseURL: 'https://de1.api.radio-browser.info/json'});

export async function searchStations(params: {
    name?: string;
    country?: string;
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
            reverse: true, ...(params.offset != null ? {offset: params.offset} : {}), ...(params.name ? {name: params.name} : {}), ...(params.country ? {country: params.country} : {}), ...(params.language ? {language: params.language} : {}), ...(params.tag ? {tag: params.tag} : {})
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
