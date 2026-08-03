import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFilterCache, saveFilterCache } from '../src/filter-cache';
import type { FilterCacheKind } from '../src/filter-cache';
import type { FilterOption } from '../src/state';

// The cache module round-trips the RAW fetch-time {value,label,code} entries
// under the two documented keys — no localization ever touches the stored
// JSON (the render layer re-localizes per UI language on each load).
const LS_LANGUAGES_CACHE = 'radio-browser-languages-cache';
const LS_COUNTRIES_CACHE = 'radio-browser-countries-cache';

const KINDS: FilterCacheKind[] = ['languages', 'countries'];

const GERMAN_LANGUAGE: FilterOption = { value: 'german', label: 'german', code: 'de' };
const UKRAINIAN_LANGUAGE: FilterOption = { value: 'ukrainian', label: 'ukrainian', code: 'ukr' };
const GERMANY: FilterOption = { value: 'DE', label: 'Germany', code: 'DE' };

beforeEach(() => {
    localStorage.removeItem(LS_LANGUAGES_CACHE);
    localStorage.removeItem(LS_COUNTRIES_CACHE);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('loadFilterCache', () => {
    it('returns null when the key is missing', () => {
        for (const kind of KINDS) {
            expect(loadFilterCache(kind)).toBeNull();
        }
    });

    it('returns null on invalid JSON', () => {
        localStorage.setItem(LS_LANGUAGES_CACHE, '{corrupt');
        expect(loadFilterCache('languages')).toBeNull();
    });

    it.each<string>(['{}', '42', '"str"'])('returns null on non-array JSON %s', (seed) => {
        localStorage.setItem(LS_LANGUAGES_CACHE, seed);
        expect(loadFilterCache('languages')).toBeNull();
    });

    it("returns null on an empty array ('[]' is never a valid cache)", () => {
        localStorage.setItem(LS_LANGUAGES_CACHE, '[]');
        expect(loadFilterCache('languages')).toBeNull();
    });

    it.each<[string, string]>([
        ['missing code', JSON.stringify([{ value: 'de', label: 'german' }])],
        ['non-string code', JSON.stringify([{ value: 'de', label: 'german', code: 42 }])],
        ['non-object entry', JSON.stringify([{ value: 'de', label: 'german', code: 'de' }, null])],
    ])('returns null when any entry is invalid (%s) — the whole list is rejected', (_case, seed) => {
        localStorage.setItem(LS_LANGUAGES_CACHE, seed);
        expect(loadFilterCache('languages')).toBeNull();
    });

    it('round-trips a valid list (save then load equals the input)', () => {
        const input = [GERMAN_LANGUAGE, UKRAINIAN_LANGUAGE];
        saveFilterCache('languages', input);
        expect(loadFilterCache('languages')).toEqual(input);

        saveFilterCache('countries', [GERMANY]);
        expect(loadFilterCache('countries')).toEqual([GERMANY]);
    });
});

describe('saveFilterCache', () => {
    it('persists the JSON array under the matching key', () => {
        saveFilterCache('languages', [GERMAN_LANGUAGE]);
        expect(JSON.parse(localStorage.getItem(LS_LANGUAGES_CACHE)!)).toEqual([GERMAN_LANGUAGE]);

        saveFilterCache('countries', [GERMANY]);
        expect(JSON.parse(localStorage.getItem(LS_COUNTRIES_CACHE)!)).toEqual([GERMANY]);
    });

    it('writes nothing for an empty array and does not clobber a saved list', () => {
        saveFilterCache('languages', [GERMAN_LANGUAGE]);
        saveFilterCache('languages', []);
        expect(JSON.parse(localStorage.getItem(LS_LANGUAGES_CACHE)!)).toEqual([GERMAN_LANGUAGE]);
    });

    it('overwrites a previously saved list (last-known-good)', () => {
        saveFilterCache('languages', [GERMAN_LANGUAGE]);
        saveFilterCache('languages', [UKRAINIAN_LANGUAGE]);
        expect(JSON.parse(localStorage.getItem(LS_LANGUAGES_CACHE)!)).toEqual([UKRAINIAN_LANGUAGE]);
    });

    it('swallows a quota-exceeded write error', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('QuotaExceededError');
        });
        expect(() => saveFilterCache('languages', [GERMAN_LANGUAGE])).not.toThrow();
    });

    it('keeps the two kinds independent', () => {
        saveFilterCache('languages', [GERMAN_LANGUAGE]);
        expect(localStorage.getItem(LS_COUNTRIES_CACHE)).toBeNull();

        saveFilterCache('countries', [GERMANY]);
        expect(JSON.parse(localStorage.getItem(LS_LANGUAGES_CACHE)!)).toEqual([GERMAN_LANGUAGE]);
        expect(JSON.parse(localStorage.getItem(LS_COUNTRIES_CACHE)!)).toEqual([GERMANY]);
    });
});
