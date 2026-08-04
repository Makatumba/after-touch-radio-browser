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

/** Full now-playing payload (FR-3 extension) — raw parsed values only;
 * fallback chaining (title/artist/art) is the components' job. */
export interface DeviceNowPlayingVerbose {
    stationName: string;
    art: string;
    artImageStatus: string;
    contentItem: {
        source: string;
        type: string;
        location: string;
        sourceAccount: string;
        itemName: string;
        containerArt: string;
    } | null;
    sourceAccount: string;
    timeTotal: number | null;
    timePosition: string;
    skipEnabled: boolean;
    skipPreviousEnabled: boolean;
    favoriteEnabled: boolean;
    seekSupported: boolean;
    shuffleSetting: string;
    repeatSetting: string;
    streamType: string;
    trackId: string;
    position: string;
    description: string;
    stationLocation: string;
}

/** Full device-info payload (FR-3 extension) — fields assigned conditionally
 * so a partial payload keeps the existing `{id}` / `{id,name,type}` shapes. */
export interface DeviceInfo {
    id: string;
    name?: string;
    type?: string;
    moduleType?: string;
    variant?: string;
    variantMode?: string;
    countryCode?: string;
    regionCode?: string;
    networkType?: string;
    macAddress?: string;
    ipAddress?: string;
    componentCategory?: string;
    serialNumber?: string;
    softwareVersion?: string;
    margeUrl?: string;
    margeAccountUuid?: string;
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
    deviceNowPlayingDetail: DeviceNowPlayingVerbose | null;
    soundtouchDevice: DeviceInfo | null;
    currentIndex: number;
    showSettings: boolean;
    skippedSetup: boolean;
    deviceMessage: string;
    settings: Settings;
}
