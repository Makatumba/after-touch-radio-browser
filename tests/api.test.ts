import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The axios instance is created once at api.ts module load. vi.hoisted keeps
// the `get` spy shared between the axios mock factory and the assertions
// below, so beforeEach can reset it while api.ts keeps the same instance.
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', () => ({ default: { create: vi.fn(() => ({ get })) } }));

import { fetchCountries, fetchLanguages, searchStations } from '../src/api';

beforeEach(() => {
    get.mockReset();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('searchStations — canonical filter params', () => {
    it('sends languageExact=true whenever a language is selected', async () => {
        get.mockResolvedValue({ data: [] });
        await searchStations({
            name: '',
            countryCode: '',
            language: 'english',
            tag: '',
            limit: 24,
            hideBroken: true,
            offset: 0,
        });
        expect(get).toHaveBeenCalledWith(
            '/stations/search',
            expect.objectContaining({
                params: expect.objectContaining({ language: 'english', languageExact: true }),
            })
        );
    });

    it('never sends language or languageExact when no language is selected', async () => {
        get.mockResolvedValue({ data: [] });
        await searchStations({
            name: '',
            countryCode: '',
            tag: '',
            limit: 24,
            hideBroken: true,
            offset: 0,
        });
        const options = get.mock.calls[0][1] as { params: Record<string, unknown> };
        expect(options.params.language).toBeUndefined();
        expect(options.params.languageExact).toBeUndefined();
    });

    it('sends countrycode (not country) when a country is selected', async () => {
        get.mockResolvedValue({ data: [] });
        await searchStations({
            name: '',
            countryCode: 'DE',
            tag: '',
            limit: 24,
            hideBroken: true,
            offset: 0,
        });
        expect(get).toHaveBeenCalledWith(
            '/stations/search',
            expect.objectContaining({
                params: expect.objectContaining({ countrycode: 'DE' }),
            })
        );
        const options = get.mock.calls[0][1] as { params: Record<string, unknown> };
        expect(options.params).not.toHaveProperty('country');
    });
});

describe('fetchLanguages / fetchCountries — dropdown option lists', () => {
    it('fetchLanguages drops entries without a valid iso_639 code and carries the iso_639 code on each option', async () => {
        get.mockResolvedValue({
            data: [
                { name: 'german', iso_639: 'de', stationcount: 50 },
                { name: 'engilsh', iso_639: null, stationcount: 5 },
                { name: 'english', iso_639: 'en', stationcount: 100 },
            ],
        });
        const result = await fetchLanguages();
        expect(get).toHaveBeenCalledWith(
            '/languages',
            expect.objectContaining({
                params: expect.objectContaining({ hidebroken: true, order: 'stationcount', reverse: true }),
            })
        );
        expect(result).toEqual([
            { value: 'english', label: 'english', code: 'en' },
            { value: 'german', label: 'german', code: 'de' },
        ]);
    });

    it('fetchCountries maps ISO 3166-1 alpha-2 codes as option values and carries the iso_3166_1 code on each option', async () => {
        get.mockResolvedValue({
            data: [
                { name: 'Ukraine', iso_3166_1: 'UA', stationcount: 10 },
                { name: 'Germany', iso_3166_1: 'DE', stationcount: 100 },
            ],
        });
        const result = await fetchCountries();
        expect(get).toHaveBeenCalledWith(
            '/countries',
            expect.objectContaining({
                params: expect.objectContaining({ hidebroken: true, order: 'stationcount', reverse: true }),
            })
        );
        expect(result).toEqual([
            { value: 'DE', label: 'Germany', code: 'DE' },
            { value: 'UA', label: 'Ukraine', code: 'UA' },
        ]);
    });
});
