import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state, render, refresh, searchFromInputs, reset, loadFilterOptions } from '../src/app';
import { setupEvents } from '../src/events';
import { getLabels, localizeFilterOptions, getLocale, filterLabelOverrides } from '../src/i18n';
import { setLanguage } from '../src/actions';
import { topStations, recentStations, searchStations, fetchLanguages, fetchCountries } from '../src/api';
import { defaultSettings } from '../src/settings';
import { getAudioElement } from '../src/player';
import type { FilterOption } from '../src/state';

// All API access goes through the mocked module so no test touches the
// network. searchStations/topStations/recentStations keep the existing app
// flow working; fetchLanguages/fetchCountries feed the dropdown data.
vi.mock('../src/api', () => ({
    topStations: vi.fn(),
    recentStations: vi.fn(),
    searchStations: vi.fn(),
    fetchLanguages: vi.fn(),
    fetchCountries: vi.fn(),
}));

const LS_LANGUAGE = 'radio-browser-language';
const LS_SOUNDTOUCH = 'radio-browser-soundtouch-host';
const LS_FAVORITES = 'radio-browser-favorites';
const LS_SETTINGS = 'radio-browser-settings';
const LS_LANGUAGES_CACHE = 'radio-browser-languages-cache';
const LS_COUNTRIES_CACHE = 'radio-browser-countries-cache';

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    state.language = 'en';
    state.mode = 'top';
    state.limit = 24;
    state.hideBroken = true;
    state.query = '';
    state.tag = '';
    state.countryCode = '';
    state.langFilter = '';
    state.languages = [];
    state.countries = [];
    state.stations = [];
    state.favorites = [];
    // REQUIRED: without an address App() renders the setup view and the
    // filter panel (with the dropdowns) never appears.
    state.soundtouchAddress = '192.168.1.42';
    state.soundtouchStatus = 'available';
    state.skippedSetup = false;
    state.settings = { ...defaultSettings };
    state.offset = 0;
    for (const key of [LS_LANGUAGE, LS_SOUNDTOUCH, LS_FAVORITES, LS_SETTINGS, LS_LANGUAGES_CACHE, LS_COUNTRIES_CACHE]) {
        localStorage.removeItem(key);
    }
    // filterLabelOverrides is shared mutable module state — reset all four
    // entries so override tests never leak into each other.
    filterLabelOverrides.en = {};
    filterLabelOverrides.de = {};
    filterLabelOverrides.ru = {};
    filterLabelOverrides.ukr = {};
    getAudioElement().removeAttribute('src');
    vi.resetAllMocks();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('canonical filter dropdowns', () => {
    it('renders the language and country filters as selects, name/tag stay inputs', () => {
        render();
        const country = document.querySelector('#country');
        expect(country).not.toBeNull();
        expect(country!.tagName).toBe('SELECT');
        const languageFilter = document.querySelector('#languageFilter');
        expect(languageFilter).not.toBeNull();
        expect(languageFilter!.tagName).toBe('SELECT');
        expect(document.querySelector('#query')!.tagName).toBe('INPUT');
        expect(document.querySelector('#tag')!.tagName).toBe('INPUT');
    });

    it('renders country options from state with the selected code marked', () => {
        state.countries = [
            { value: 'DE', label: 'Germany', code: 'DE' },
            { value: 'UA', label: 'Ukraine', code: 'UA' },
        ];
        state.countryCode = 'DE';
        render();
        const t = getLabels(state);
        const country = document.querySelector<HTMLSelectElement>('#country')!;
        const options = Array.from(country.options);
        expect(options.map((o) => o.text)).toEqual([t.allCountries, 'Germany', 'Ukraine']);
        expect(options.find((o) => o.value === 'DE')!.selected).toBe(true);
        expect(options.find((o) => o.value === 'UA')!.selected).toBe(false);
    });

    it('renders language options from state with the selected value marked', () => {
        state.languages = [{ value: 'english', label: 'english', code: 'en' }];
        state.langFilter = 'english';
        render();
        const t = getLabels(state);
        const languageFilter = document.querySelector<HTMLSelectElement>('#languageFilter')!;
        const options = Array.from(languageFilter.options);
        // en-locale DisplayNames renders code 'en' as "English" (title case).
        expect(options.map((o) => o.text)).toEqual([t.allLanguages, 'English']);
        expect(options.find((o) => o.value === 'english')!.selected).toBe(true);
    });

    it('renders only the All option when the option lists are empty (fetch failure fallback)', () => {
        render();
        const t = getLabels(state);
        const country = document.querySelector<HTMLSelectElement>('#country')!;
        expect(country.options.length).toBe(1);
        expect(country.options[0].text).toBe(t.allCountries);
        const languageFilter = document.querySelector<HTMLSelectElement>('#languageFilter')!;
        expect(languageFilter.options.length).toBe(1);
        expect(languageFilter.options[0].text).toBe(t.allLanguages);
    });

    it('selecting a country triggers an immediate search with countryCode and offset 0', async () => {
        state.countries = [{ value: 'DE', label: 'Germany', code: 'DE' }];
        vi.mocked(searchStations).mockResolvedValue([]);
        render();
        setupEvents();
        const select = document.querySelector<HTMLSelectElement>('#country')!;
        select.value = 'DE';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await vi.waitFor(() => expect(state.countryCode).toBe('DE'), { timeout: 500 });
        await vi.waitFor(
            () => expect(searchStations).toHaveBeenCalledWith(expect.objectContaining({ countryCode: 'DE', offset: 0 })),
            { timeout: 500 }
        );
        expect(state.mode).toBe('search');
    });

    it('selecting a language triggers an immediate search with language and offset 0', async () => {
        state.languages = [{ value: 'english', label: 'english', code: 'en' }];
        vi.mocked(searchStations).mockResolvedValue([]);
        render();
        setupEvents();
        const select = document.querySelector<HTMLSelectElement>('#languageFilter')!;
        select.value = 'english';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await vi.waitFor(() => expect(state.langFilter).toBe('english'), { timeout: 500 });
        await vi.waitFor(
            () => expect(searchStations).toHaveBeenCalledWith(expect.objectContaining({ language: 'english', offset: 0 })),
            { timeout: 500 }
        );
        expect(state.mode).toBe('search');
    });

    it('loadFilterOptions fills the dropdown data and survives fetch failures', async () => {
        vi.mocked(fetchLanguages).mockResolvedValue([{ value: 'english', label: 'english', code: 'en' }]);
        vi.mocked(fetchCountries).mockResolvedValue([{ value: 'DE', label: 'Germany', code: 'DE' }]);
        await loadFilterOptions();
        expect(state.languages).toEqual([{ value: 'english', label: 'english', code: 'en' }]);
        expect(state.countries).toEqual([{ value: 'DE', label: 'Germany', code: 'DE' }]);

        // The success phase above writes both caches once the feature lands;
        // clear them so the failure phase still exercises the no-cache
        // contract (empty lists, All-only dropdowns).
        localStorage.removeItem(LS_LANGUAGES_CACHE);
        localStorage.removeItem(LS_COUNTRIES_CACHE);

        // On failure the lists stay empty and the app still renders.
        state.languages = [];
        state.countries = [];
        vi.mocked(fetchLanguages).mockRejectedValue(new Error('offline'));
        vi.mocked(fetchCountries).mockRejectedValue(new Error('offline'));
        await loadFilterOptions();
        expect(state.languages).toEqual([]);
        expect(state.countries).toEqual([]);
        render();
        expect(document.querySelector('#country')).not.toBeNull();
        expect(document.querySelector('#languageFilter')).not.toBeNull();
    });

    it('reset() clears the country code and language filter', () => {
        vi.mocked(topStations).mockResolvedValue([]);
        state.countryCode = 'DE';
        state.langFilter = 'english';
        reset();
        expect(state.countryCode).toBe('');
        expect(state.langFilter).toBe('');
    });

    it('Enter on the country select does not trigger a search', async () => {
        render();
        setupEvents();
        const select = document.querySelector<HTMLSelectElement>('#country')!;
        select.focus();
        select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(searchStations).not.toHaveBeenCalled();
    });

    it('escapes option values and labels when rendering the dropdowns', () => {
        // code 'XX' is unmappable (NOTE: not 'ZZ' — this ICU resolves 'ZZ' to
        // the localized "Unknown Region" name), so the label survives via the
        // existing-label fallback and must still be escaped in the HTML.
        state.countries = [{ value: 'A&B', label: 'AT&T <Rock>', code: 'XX' }];
        render();
        const country = document.querySelector<HTMLSelectElement>('#country')!;
        expect(country.innerHTML).toContain('value="A&amp;B"');
        expect(country.innerHTML).toContain('AT&amp;T &lt;Rock&gt;');
    });
});

describe('localizeFilterOptions (unit)', () => {
    it('maps ukr to the uk locale and passes other languages through', () => {
        expect(getLocale('en')).toBe('en');
        expect(getLocale('de')).toBe('de');
        expect(getLocale('ru')).toBe('ru');
        expect(getLocale('ukr')).toBe('uk');
    });

    it('localizes German region codes to German labels, sorted, without mutating the input', () => {
        const input = [
            { value: 'DE', label: 'Germany', code: 'DE' },
            { value: 'AT', label: 'Austria', code: 'AT' },
        ];
        const result = localizeFilterOptions(input, 'de', 'region');
        expect(result.map((o) => o.label)).toEqual(['Deutschland', 'Österreich']);
        expect(result).not.toBe(input);
        expect(input[0].label).toBe('Germany');
        expect(result.map((o) => o.value)).toEqual(['DE', 'AT']);
    });

    it('gives a label override precedence over Intl.DisplayNames', () => {
        filterLabelOverrides.de['DE'] = 'Deutschland (override)';
        const result = localizeFilterOptions([{ value: 'DE', label: 'Germany', code: 'DE' }], 'de', 'region');
        expect(result[0].label).toBe('Deutschland (override)');
    });

    it('falls back to the existing label when the code cannot be mapped', () => {
        // code 'XX' is not a known region in this ICU; the existing label must win.
        const result = localizeFilterOptions([{ value: 'XX', label: 'Zzzland', code: 'XX' }], 'de', 'region');
        expect(result[0].label).toBe('Zzzland');
    });

    it('localizes language codes to the active locale (de and ukr)', () => {
        const option = { value: 'english', label: 'english', code: 'en' };
        expect(localizeFilterOptions([option], 'de', 'language')[0].label).toBe('Englisch');
        expect(localizeFilterOptions([option], 'ukr', 'language')[0].label).toBe('англійська');
    });

    it('localizes Ukrainian region codes', () => {
        const result = localizeFilterOptions([{ value: 'DE', label: 'Germany', code: 'DE' }], 'ukr', 'region');
        expect(result[0].label).toBe('Німеччина');
    });

    it('sorts by the localized label in the en locale', () => {
        // Input is reversed on purpose: sorting must reorder by label.
        const result = localizeFilterOptions(
            [
                { value: 'UA', label: 'Ukraine', code: 'UA' },
                { value: 'DE', label: 'Germany', code: 'DE' },
            ],
            'en',
            'region'
        );
        expect(result.map((o) => o.label)).toEqual(['Germany', 'Ukraine']);
        expect(result.map((o) => o.value)).toEqual(['DE', 'UA']);
    });

    it('sorts by German collation, placing Ö after D', () => {
        // Input is reversed on purpose: German collation puts 'Ö' after 'D'.
        const result = localizeFilterOptions(
            [
                { value: 'AT', label: 'Austria', code: 'AT' },
                { value: 'DE', label: 'Germany', code: 'DE' },
            ],
            'de',
            'region'
        );
        expect(result.map((o) => o.label)).toEqual(['Deutschland', 'Österreich']);
        expect(result.map((o) => o.value)).toEqual(['DE', 'AT']);
    });
});

describe('localized filter dropdowns', () => {
    it('renders country options localized to the German UI language', () => {
        state.language = 'de';
        state.countries = [
            { value: 'DE', label: 'Germany', code: 'DE' },
            { value: 'AT', label: 'Austria', code: 'AT' },
        ];
        render();
        const t = getLabels(state);
        const country = document.querySelector<HTMLSelectElement>('#country')!;
        const options = Array.from(country.options);
        expect(options.map((o) => o.text)).toEqual([t.allCountries, 'Deutschland', 'Österreich']);
        expect(country.innerHTML).toContain('Deutschland');
        expect(country.innerHTML).toContain('Österreich');
        // API values stay canonical (ISO codes), only the label is localized.
        expect(options.map((o) => o.value)).toEqual(['', 'DE', 'AT']);
    });

    it('re-localizes the dropdowns when the UI language switches without refetching', () => {
        state.language = 'en';
        state.countries = [{ value: 'DE', label: 'Germany', code: 'DE' }];
        render();
        const tEn = getLabels(state);
        const country = document.querySelector<HTMLSelectElement>('#country')!;
        expect(Array.from(country.options).map((o) => o.text)).toEqual([tEn.allCountries, 'Germany']);

        // Same as the header chip handler: setLanguage() then re-render.
        setLanguage('de', state);
        render();

        expect(state.language).toBe('de');
        expect(localStorage.getItem('radio-browser-language')).toBe('de');
        const tDe = getLabels(state);
        const reRendered = document.querySelector<HTMLSelectElement>('#country')!;
        expect(Array.from(reRendered.options).map((o) => o.text)).toEqual([tDe.allCountries, 'Deutschland']);
    });
});

describe('filter option cache', () => {
    const LANGUAGE_LIST: FilterOption[] = [{ value: 'english', label: 'english', code: 'en' }];
    const COUNTRY_LIST: FilterOption[] = [{ value: 'DE', label: 'Germany', code: 'DE' }];

    it('persists raw fetch results under both cache keys', async () => {
        vi.mocked(fetchLanguages).mockResolvedValue(LANGUAGE_LIST);
        vi.mocked(fetchCountries).mockResolvedValue(COUNTRY_LIST);
        await loadFilterOptions();
        expect(JSON.parse(localStorage.getItem(LS_LANGUAGES_CACHE)!)).toEqual(LANGUAGE_LIST);
        expect(JSON.parse(localStorage.getItem(LS_COUNTRIES_CACHE)!)).toEqual(COUNTRY_LIST);
    });

    it('persists the raw English labels even when the UI language is not English', async () => {
        // The stored entries must be the fetch-time values (never the
        // localized render form) so a cached list re-localizes per UI language.
        state.language = 'de';
        vi.mocked(fetchLanguages).mockResolvedValue(LANGUAGE_LIST);
        vi.mocked(fetchCountries).mockResolvedValue(COUNTRY_LIST);
        await loadFilterOptions();
        expect(JSON.parse(localStorage.getItem(LS_LANGUAGES_CACHE)!)).toEqual(LANGUAGE_LIST);
        expect(JSON.parse(localStorage.getItem(LS_COUNTRIES_CACHE)!)).toEqual(COUNTRY_LIST);
    });

    it('falls back to the cached lists when both fetches fail', async () => {
        localStorage.setItem(LS_LANGUAGES_CACHE, JSON.stringify(LANGUAGE_LIST));
        localStorage.setItem(LS_COUNTRIES_CACHE, JSON.stringify(COUNTRY_LIST));
        vi.mocked(fetchLanguages).mockRejectedValue(new Error('offline'));
        vi.mocked(fetchCountries).mockRejectedValue(new Error('offline'));
        await loadFilterOptions();
        expect(state.languages).toEqual(LANGUAGE_LIST);
        expect(state.countries).toEqual(COUNTRY_LIST);
        // loadFilterOptions renders at the end — the dropdowns must show the
        // cached options (en-locale DisplayNames title-cases code 'en').
        const country = document.querySelector<HTMLSelectElement>('#country')!;
        expect(Array.from(country.options).map((o) => o.text)).toContain('Germany');
        const languageFilter = document.querySelector<HTMLSelectElement>('#languageFilter')!;
        expect(Array.from(languageFilter.options).map((o) => o.text)).toContain('English');
    });

    it('falls back to the cached languages list when the fetch returns an empty array', async () => {
        localStorage.setItem(LS_LANGUAGES_CACHE, JSON.stringify(LANGUAGE_LIST));
        vi.mocked(fetchLanguages).mockResolvedValue([]);
        vi.mocked(fetchCountries).mockResolvedValue(COUNTRY_LIST);
        await loadFilterOptions();
        expect(state.languages).toEqual(LANGUAGE_LIST);
        // The cache is neither removed nor overwritten by the empty result.
        expect(localStorage.getItem(LS_LANGUAGES_CACHE)).toBe(JSON.stringify(LANGUAGE_LIST));
    });

    it('keeps the languages empty when the fetch returns [] and no cache exists', async () => {
        vi.mocked(fetchLanguages).mockResolvedValue([]);
        vi.mocked(fetchCountries).mockResolvedValue(COUNTRY_LIST);
        await loadFilterOptions();
        expect(state.languages).toEqual([]);
        expect(localStorage.getItem(LS_LANGUAGES_CACHE)).toBeNull();
    });

    it('keeps the languages fallback independent of a failing countries fetch', async () => {
        localStorage.setItem(LS_LANGUAGES_CACHE, JSON.stringify(LANGUAGE_LIST));
        vi.mocked(fetchLanguages).mockRejectedValue(new Error('offline'));
        vi.mocked(fetchCountries).mockResolvedValue(COUNTRY_LIST);
        await loadFilterOptions();
        expect(state.languages).toEqual(LANGUAGE_LIST);
        expect(state.countries).toEqual(COUNTRY_LIST);
        expect(JSON.parse(localStorage.getItem(LS_COUNTRIES_CACHE)!)).toEqual(COUNTRY_LIST);
    });

    it('keeps the countries fallback independent of a failing languages fetch', async () => {
        localStorage.setItem(LS_COUNTRIES_CACHE, JSON.stringify(COUNTRY_LIST));
        vi.mocked(fetchLanguages).mockResolvedValue(LANGUAGE_LIST);
        vi.mocked(fetchCountries).mockRejectedValue(new Error('offline'));
        await loadFilterOptions();
        expect(state.languages).toEqual(LANGUAGE_LIST);
        expect(state.countries).toEqual(COUNTRY_LIST);
        expect(JSON.parse(localStorage.getItem(LS_LANGUAGES_CACHE)!)).toEqual(LANGUAGE_LIST);
    });

    it('overwrites the cache on a later successful fetch', async () => {
        const stale: FilterOption[] = [{ value: 'german', label: 'german', code: 'de' }];
        localStorage.setItem(LS_LANGUAGES_CACHE, JSON.stringify(stale));
        vi.mocked(fetchLanguages).mockResolvedValue(LANGUAGE_LIST);
        vi.mocked(fetchCountries).mockResolvedValue(COUNTRY_LIST);
        await loadFilterOptions();
        expect(JSON.parse(localStorage.getItem(LS_LANGUAGES_CACHE)!)).toEqual(LANGUAGE_LIST);
    });

    it('keeps the fetch authoritative when localStorage is full', async () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('QuotaExceededError');
        });
        vi.mocked(fetchLanguages).mockResolvedValue(LANGUAGE_LIST);
        vi.mocked(fetchCountries).mockResolvedValue(COUNTRY_LIST);
        await loadFilterOptions();
        expect(state.languages).toEqual(LANGUAGE_LIST);
        expect(state.countries).toEqual(COUNTRY_LIST);
    });
});
