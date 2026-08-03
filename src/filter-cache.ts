import type { FilterOption } from './state';

export type FilterCacheKind = 'languages' | 'countries';

const KEYS: Record<FilterCacheKind, string> = {
    languages: 'radio-browser-languages-cache',
    countries: 'radio-browser-countries-cache',
};

function isFilterOption(x: unknown): x is FilterOption {
    if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
    const entry = x as Record<string, unknown>;
    return typeof entry.value === 'string' && typeof entry.label === 'string' && typeof entry.code === 'string';
}

export function loadFilterCache(kind: FilterCacheKind): FilterOption[] | null {
    try {
        const raw = localStorage.getItem(KEYS[kind]);
        if (raw === null) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) return null;
        if (!parsed.every(isFilterOption)) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function saveFilterCache(kind: FilterCacheKind, options: FilterOption[]): void {
    if (options.length === 0) return;
    try {
        localStorage.setItem(KEYS[kind], JSON.stringify(options));
    } catch {
        // quota/unavailable — best-effort, never throw
    }
}
