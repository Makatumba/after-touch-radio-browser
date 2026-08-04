import type {Language} from './i18n';

export type Mode = 'search' | 'top' | 'recent' | 'favorites';

export type SortKey = 'name_asc' | 'name_desc' | 'clickcount' | 'clicktrend' | 'votes';

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
    clicktrend?: number;
    tags?: string;
    lastcheckok?: boolean;
}

export interface Settings {
    enablePreview: boolean;
}

export interface FilterOption {
    value: string;
    label: string;
    code: string;
}

export interface State {
    language: Language;
    query: string;
    countryCode: string;
    langFilter: string;
    languages: FilterOption[];
    countries: FilterOption[];
    tag: string;
    limit: number;
    hideBroken: boolean;
    sort: SortKey;
    mode: Mode;
    stations: Station[];
    offset: number;
    favorites: Station[];
    nowPlaying: string;
    playerMeta: string;
    status: string;
    soundtouchAddress: string;
    soundtouchStatus: 'idle' | 'checking' | 'available' | 'unreachable';
    wsStatus: 'idle' | 'connecting' | 'connected' | 'reconnecting';
    deviceNowPlaying: string;
    deviceArtist: string;
    deviceAlbum: string;
    deviceSource: string;
    devicePlayStatus: string;
    deviceVolume: number;
    deviceMute: boolean;
    soundtouchDevice: { id: string; name?: string; type?: string } | null;
    currentIndex: number;
    showSettings: boolean;
    skippedSetup: boolean;
    deviceMessage: string;
    settings: Settings;
}
