import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state, refresh, render, loadNextResultSet, loadPreviousResultSet, reset, searchFromInputs } from '../src/app';
import { setupEvents } from '../src/events';
import { topStations, recentStations, searchStations } from '../src/api';
import { defaultSettings } from '../src/settings';
import { getAudioElement } from '../src/player';
import type { Station } from '../src/state';

// The five sort keys land with the sortable-results feature (FR-1 extension).
type SortKey = 'name_asc' | 'name_desc' | 'clickcount' | 'clicktrend' | 'votes';
// state.sort is added with the same feature. Until src/state.ts gains the
// property, access it through this typed view so the tests stay type-clean.
const sortView = state as unknown as { sort: SortKey };

// SORT_API_PARAMS (sort key → API order/reverse mapping) is added with the
// same feature; the cast keeps this file type-clean while the export does not
// exist yet. It is imported from the app module (not src/api, which this file
// mocks with a fixed factory).
async function loadSortParams() {
    return (await import('../src/app')) as unknown as {
        SORT_API_PARAMS: Record<SortKey, { order: string; reverse?: boolean }>;
    };
}

// The prev/next buttons must page through station sets (offset-based), NOT
// cycle through modes. All API calls go through the mocked module so no test
// touches the network.
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

function makeStations(count: number, prefix: string): Station[] {
    return Array.from({ length: count }, (_, i) => ({
        stationuuid: `${prefix}-${i}`,
        name: `${prefix} ${i}`,
    }));
}

const LIMIT = 24;
const PAGE1 = makeStations(LIMIT, 'page1');
const PAGE2 = makeStations(LIMIT, 'page2');
const SHORT_PAGE = makeStations(6, 'last');
const FAVS = makeStations(30, 'fav');

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    state.language = 'en';
    state.mode = 'top';
    state.limit = LIMIT;
    state.hideBroken = true;
    state.query = '';
    state.countryCode = '';
    state.langFilter = '';
    state.languages = [];
    state.countries = [];
    state.tag = '';
    state.stations = [];
    state.favorites = [];
    // REQUIRED: without an address App() renders the setup view and the
    // results footer (with the prev/next buttons) never appears.
    state.soundtouchAddress = '192.168.1.42';
    state.soundtouchStatus = 'available';
    state.skippedSetup = false;
    state.settings = { ...defaultSettings };
    // The offset of the currently shown set (0 = first set). Added with the
    // list-pagination feature; reset here so tests stay isolated.
    state.offset = 0;
    sortView.sort = 'clickcount';
    for (const key of [LS_LANGUAGE, LS_SOUNDTOUCH, LS_FAVORITES, LS_SETTINGS]) {
        localStorage.removeItem(key);
    }
    getAudioElement().removeAttribute('src');
    vi.resetAllMocks();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('list navigation — prev/next load station sets', () => {
    it('loadNextResultSet pages forward in the current mode via offset', async () => {
        vi.mocked(topStations)
            .mockResolvedValueOnce(PAGE1)
            .mockResolvedValueOnce(PAGE2);

        await refresh('top');
        expect(state.mode).toBe('top');
        expect(state.offset).toBe(0);
        expect(state.stations).toEqual(PAGE1);

        await loadNextResultSet();

        // Stays in the same mode (currently it cycles to 'recent') and loads
        // the next set starting at offset = previous offset + limit.
        expect(state.mode).toBe('top');
        expect(state.offset).toBe(LIMIT);
        expect(topStations).toHaveBeenLastCalledWith(LIMIT, true, LIMIT);
        expect(state.stations).toEqual(PAGE2);
    });

    it('loadPreviousResultSet pages back, clamped at the first set', async () => {
        vi.mocked(topStations)
            .mockResolvedValueOnce(PAGE1)
            .mockResolvedValueOnce(PAGE2)
            .mockResolvedValueOnce(PAGE1);

        await refresh('top');      // first set (offset 0)
        await loadNextResultSet(); // second set (offset 24)
        await loadPreviousResultSet();

        expect(state.mode).toBe('top');
        expect(state.offset).toBe(0);
        expect(topStations).toHaveBeenLastCalledWith(LIMIT, true, 0);
        expect(state.stations).toEqual(PAGE1);

        // Already on the first set: prev is a no-op (no extra API call).
        await loadPreviousResultSet();
        expect(state.offset).toBe(0);
        expect(state.stations).toEqual(PAGE1);
        expect(topStations).toHaveBeenCalledTimes(3);
    });

    it('loadNextResultSet does not advance past a short final set', async () => {
        vi.mocked(topStations)
            .mockResolvedValueOnce(PAGE1)
            .mockResolvedValueOnce(SHORT_PAGE);

        await refresh('top');      // full set
        await loadNextResultSet(); // short final set (6 < limit)

        const calls = vi.mocked(topStations).mock.calls.length;
        await loadNextResultSet(); // no-op — no extra API call

        expect(state.offset).toBe(LIMIT);
        expect(state.stations).toEqual(SHORT_PAGE);
        expect(topStations).toHaveBeenCalledTimes(calls);
    });

    it('loadNextResultSet in search mode keeps filters and passes offset', async () => {
        state.query = 'jazz';
        state.countryCode = 'DE';
        state.langFilter = 'english';
        state.tag = 'smooth';
        vi.mocked(searchStations)
            .mockResolvedValueOnce(PAGE1)
            .mockResolvedValueOnce(PAGE2);

        await refresh('search');
        await loadNextResultSet();

        expect(state.mode).toBe('search');
        expect(state.offset).toBe(LIMIT);
        expect(searchStations).toHaveBeenLastCalledWith(
            expect.objectContaining({
                name: 'jazz',
                countryCode: 'DE',
                language: 'english',
                tag: 'smooth',
                limit: LIMIT,
                hideBroken: true,
                offset: LIMIT,
            })
        );
        expect(state.stations).toEqual(PAGE2);
    });

    it('loadNextResultSet in recent mode passes offset to recentStations', async () => {
        vi.mocked(recentStations)
            .mockResolvedValueOnce(PAGE1)
            .mockResolvedValueOnce(PAGE2);

        await refresh('recent');
        await loadNextResultSet();

        expect(state.mode).toBe('recent');
        expect(state.offset).toBe(LIMIT);
        expect(recentStations).toHaveBeenLastCalledWith(LIMIT, true, LIMIT);
        expect(state.stations).toEqual(PAGE2);
    });

    it('a mode change restarts at the first set (offset reset to 0)', async () => {
        vi.mocked(topStations)
            .mockResolvedValueOnce(PAGE1)
            .mockResolvedValueOnce(PAGE2);

        await refresh('top');
        await loadNextResultSet(); // offset 24

        vi.mocked(recentStations).mockResolvedValueOnce(PAGE1);
        await refresh('recent');

        expect(state.mode).toBe('recent');
        expect(state.offset).toBe(0);
        expect(recentStations).toHaveBeenCalledWith(LIMIT, true, 0);
    });

    it('reset() restarts at the first set of the top list', async () => {
        vi.mocked(topStations)
            .mockResolvedValueOnce(PAGE1)
            .mockResolvedValueOnce(PAGE2)
            .mockResolvedValueOnce(PAGE1);

        await refresh('top');
        await loadNextResultSet(); // offset 24

        reset();
        expect(state.mode).toBe('top');
        expect(state.offset).toBe(0);

        await vi.waitFor(() => expect(topStations).toHaveBeenLastCalledWith(LIMIT, true, 0), { timeout: 500 });
        expect(state.stations).toEqual(PAGE1);
    });

    it('a new search from the inputs restarts at the first set', async () => {
        vi.mocked(searchStations)
            .mockResolvedValueOnce(PAGE1)
            .mockResolvedValueOnce(PAGE2)
            .mockResolvedValueOnce(PAGE1);

        await refresh('search');
        await loadNextResultSet(); // offset 24

        render();
        const query = document.querySelector<HTMLInputElement>('#query')!;
        expect(query).not.toBeNull();
        query.value = 'jazz';

        searchFromInputs();

        await vi.waitFor(
            () => expect(searchStations).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'jazz', offset: 0 })),
            { timeout: 500 }
        );
        expect(state.mode).toBe('search');
        expect(state.offset).toBe(0);
        expect(state.stations).toEqual(PAGE1);
    });

    it('favorites pages through the local list without any API call', async () => {
        state.favorites = FAVS;

        await refresh('favorites');
        expect(state.mode).toBe('favorites');
        expect(state.offset).toBe(0);
        expect(state.stations).toEqual(FAVS.slice(0, LIMIT));
        expect(topStations).not.toHaveBeenCalled();
        expect(recentStations).not.toHaveBeenCalled();
        expect(searchStations).not.toHaveBeenCalled();

        await loadNextResultSet();
        expect(state.offset).toBe(LIMIT);
        expect(state.stations).toEqual(FAVS.slice(LIMIT, FAVS.length));

        // Short final set — next is a no-op.
        await loadNextResultSet();
        expect(state.offset).toBe(LIMIT);
        expect(state.stations).toEqual(FAVS.slice(LIMIT, FAVS.length));

        await loadPreviousResultSet();
        expect(state.offset).toBe(0);
        expect(state.stations).toEqual(FAVS.slice(0, LIMIT));
        expect(topStations).not.toHaveBeenCalled();
    });

    it('disables Prev on the first set and Next on a short final set', async () => {
        vi.mocked(topStations)
            .mockResolvedValueOnce(PAGE1)
            .mockResolvedValueOnce(SHORT_PAGE);

        await refresh('top');
        const firstPrev = document.querySelector<HTMLButtonElement>('#prevResults')!;
        const firstNext = document.querySelector<HTMLButtonElement>('#nextResults')!;
        expect(firstPrev.disabled).toBe(true);  // on the first set
        expect(firstNext.disabled).toBe(false); // full set — more ahead

        await loadNextResultSet();
        const lastPrev = document.querySelector<HTMLButtonElement>('#prevResults')!;
        const lastNext = document.querySelector<HTMLButtonElement>('#nextResults')!;
        expect(lastPrev.disabled).toBe(false); // a previous set exists
        expect(lastNext.disabled).toBe(true);  // short set — no more
    });

    it('disables both buttons when the current set is empty', async () => {
        vi.mocked(topStations).mockResolvedValueOnce([]);

        await refresh('top');
        const prev = document.querySelector<HTMLButtonElement>('#prevResults')!;
        const next = document.querySelector<HTMLButtonElement>('#nextResults')!;
        expect(prev.disabled).toBe(true);
        expect(next.disabled).toBe(true);
    });

    it('clicking Next loads the next set of the current list', async () => {
        vi.mocked(topStations)
            .mockResolvedValueOnce(PAGE1)
            .mockResolvedValueOnce(PAGE2);

        render();
        setupEvents();
        await refresh('top');

        document.querySelector<HTMLButtonElement>('#nextResults')!.click();

        await vi.waitFor(() => expect(topStations).toHaveBeenLastCalledWith(LIMIT, true, LIMIT), { timeout: 500 });
        expect(state.mode).toBe('top');
        expect(state.offset).toBe(LIMIT);
        expect(state.stations).toEqual(PAGE2);
    });
});

describe('sortable search results (FR-1 extension)', () => {
    it.each(['name_asc', 'name_desc', 'clickcount', 'clicktrend', 'votes'] as const)(
        'search mode sends the mapped order/reverse for sort %s',
        async (sortKey) => {
            const { SORT_API_PARAMS } = await loadSortParams();
            sortView.sort = sortKey;
            vi.mocked(searchStations).mockResolvedValueOnce(PAGE1);
            await refresh('search');
            expect(searchStations).toHaveBeenLastCalledWith(
                expect.objectContaining({ ...SORT_API_PARAMS[sortKey], offset: 0 })
            );
            // name_asc maps to order=name without reverse — it must not reach
            // the API call at all (reverse=false is omitted on the wire).
            if (sortKey === 'name_asc') {
                expect(vi.mocked(searchStations).mock.calls.at(-1)![0]).not.toHaveProperty('reverse');
            }
        }
    );

    it('changing the sort in search mode re-runs the search at offset 0 and stays in search mode', async () => {
        vi.mocked(searchStations).mockResolvedValueOnce(PAGE1);
        state.mode = 'search';
        render();
        setupEvents();
        const sort = document.querySelector<HTMLSelectElement>('#sort')!;
        sort.value = 'name_desc';
        sort.dispatchEvent(new Event('change', { bubbles: true }));
        await vi.waitFor(
            () =>
                expect(searchStations).toHaveBeenLastCalledWith(
                    expect.objectContaining({ order: 'name', reverse: true, offset: 0 })
                ),
            { timeout: 500 }
        );
        expect(state.mode).toBe('search');
        expect(state.offset).toBe(0);
        expect(sortView.sort).toBe('name_desc');
    });

    it('changing the sort in favorites mode re-sorts locally without any API call', async () => {
        const VOTED = Array.from({ length: 30 }, (_, i) => ({
            stationuuid: `v-${i}`,
            name: `Vote ${i}`,
            votes: i,
        }));
        state.favorites = [...VOTED];
        state.mode = 'favorites';
        render();
        setupEvents();
        const sort = document.querySelector<HTMLSelectElement>('#sort')!;
        sort.value = 'votes';
        sort.dispatchEvent(new Event('change', { bubbles: true }));
        await vi.waitFor(() => expect(state.stations[0]?.stationuuid).toBe('v-29'), { timeout: 500 });
        expect(state.mode).toBe('favorites');
        expect(state.offset).toBe(0);
        expect(sortView.sort).toBe('votes');
        expect(state.stations.map(s => s.stationuuid)).toEqual(
            [...VOTED].sort((a, b) => b.votes! - a.votes!).slice(0, LIMIT).map(s => s.stationuuid)
        );
        // The stored favorites array keeps insertion order.
        expect(state.favorites).toEqual(VOTED);
        expect(topStations).not.toHaveBeenCalled();
        expect(recentStations).not.toHaveBeenCalled();
        expect(searchStations).not.toHaveBeenCalled();
    });

    it.each(['top', 'recent'] as const)(
        'changing the sort in %s mode starts a search and switches to search mode',
        async (mode) => {
            vi.mocked(searchStations).mockResolvedValueOnce(PAGE1);
            state.mode = mode;
            render();
            setupEvents();
            const sort = document.querySelector<HTMLSelectElement>('#sort')!;
            sort.value = 'name_asc';
            sort.dispatchEvent(new Event('change', { bubbles: true }));
            await vi.waitFor(() => expect(searchStations).toHaveBeenCalled(), { timeout: 500 });
            expect(searchStations).toHaveBeenLastCalledWith(
                expect.objectContaining({ order: 'name', offset: 0 })
            );
            expect(state.mode).toBe('search');
            expect(state.offset).toBe(0);
            expect(sortView.sort).toBe('name_asc');
        }
    );

    it('appends the localized sort label to the status line in search mode', async () => {
        vi.mocked(searchStations).mockResolvedValueOnce(PAGE1);
        await refresh('search');
        expect(state.status).toBe('24 loaded · Popular (1 day)');
        expect(document.querySelector('.toolbar small')!.textContent).toBe('24 loaded · Popular (1 day)');
    });

    it('shows the localized label of the active sort in the status line', async () => {
        vi.mocked(searchStations).mockResolvedValueOnce(PAGE1);
        sortView.sort = 'name_asc';
        await refresh('search');
        expect(state.status).toBe('24 loaded · Name (A–Z)');
    });

    it('keeps the bare N loaded status in top mode', async () => {
        vi.mocked(topStations).mockResolvedValueOnce(PAGE1);
        await refresh('top');
        expect(state.status).toBe('24 loaded');
    });

    it('appends the sort label to the status line in favorites mode', async () => {
        state.favorites = FAVS;
        state.mode = 'favorites';
        await refresh('favorites');
        expect(state.status).toBe('24 loaded · Popular (1 day)');
    });

    it('reset restores the default sort', async () => {
        vi.mocked(topStations).mockResolvedValueOnce(PAGE1);
        sortView.sort = 'name_asc';
        reset();
        expect(sortView.sort).toBe('clickcount');
    });

    it('keeps the sort choice session-only (no localStorage writes)', async () => {
        vi.mocked(searchStations).mockResolvedValueOnce(PAGE1);
        state.mode = 'search';
        render();
        setupEvents();
        const keysBefore = Object.keys(localStorage);
        const sort = document.querySelector<HTMLSelectElement>('#sort')!;
        sort.value = 'votes';
        sort.dispatchEvent(new Event('change', { bubbles: true }));
        await vi.waitFor(() => expect(searchStations).toHaveBeenCalled(), { timeout: 500 });
        expect(Object.keys(localStorage)).toEqual(keysBefore);
    });
});
