import type {Language} from './i18n';

export type Mode = 'search' | 'top' | 'recent' | 'favorites';

export interface Station {
    stationuuid: string;
    name: string;
    url?: string;
    url_resolved?: string;
    homepage?: string;
    country?: string;
    countrycode?: string;
    language?: string;
    codec?: string;
    bitrate?: number;
    votes?: number;
    clickcount?: number;
    tags?: string;
    lastcheckok?: boolean;
}

export interface State {
    language: Language;
    query: string;
    country: string;
    langFilter: string;
    tag: string;
    limit: number;
    hideBroken: boolean;
    mode: Mode;
    stations: Station[];
    favorites: Station[];
    nowPlaying: string;
    playerMeta: string;
    status: string;
    soundtouchAddress: string;
    currentIndex: number;
}
