import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state, refresh, render, loadNextResultSet, loadPreviousResultSet, reset, searchFromInputs } from '../src/app';
import { setupEvents } from '../src/events';
import { topStations, recentStations, searchStations } from '../src/api';
import { defaultSettings } from '../src/settings';
import { getAudioElement } from '../src/player';
import type { Station } from '../src/state';

// The prev/next buttons must page through station sets (offset-based), NOT
// cycle through modes. All API calls go through the mocked module so no test
// touches the network.
vi.mock('../src/api', () => ({
    topStations: vi.fn(),
    recentStations: vi.fn(),
    searchStations: vi.fn(),
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
    state.country = '';
    state.langFilter = '';
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
        state.country = 'Germany';
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
                country: 'Germany',
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
