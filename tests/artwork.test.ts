import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from '../src/app';
import type { Station } from '../src/state';
import {
    getArtworkLoadState,
    loadArtworkCache,
    playingStationArtUrl,
    rememberStationArtwork,
    renderArtworkSlot,
    requestArtwork,
    resetArtworkState,
    resolveArtworkUrl,
    saveArtworkCache,
    scanArtwork,
    setRenderHook,
} from '../src/artwork';

// The FR-6 artwork cache mirrors the FR-1 filter-cache convention: the URL is
// stored per station under `radio-browser-art-<stationuuid>` as a JSON string,
// last-known-good, best-effort — a malformed or unavailable cache is ignored.
const LS_ART_PREFIX = 'radio-browser-art-';

// The escaping cases need a URL that must be entity-escaped in HTML; the
// DOM round-trip cases use clean URLs so the attribute values are unambiguous.
const ART_URL = 'http://cdn.example.com/art.png?a=1&b=2';
const ART_URL_2 = 'http://cdn.example.com/art2.png';
const ART_URL_3 = 'http://cdn.example.com/art3.png';

// jsdom never fires Image load/error events, and the artwork module must
// resolve `Image` at request time (plain global lookup) for this stub to be
// seen — capturing it at module load would make every test here fail.
class FakeImage {
    static instances: FakeImage[] = [];
    src = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor() {
        FakeImage.instances.push(this);
    }
}

// Station.favicon lands in src/state.ts with the FR-6 implementation wave;
// until then stations are typed through this view so the file stays
// type-clean at every commit in the sequence.
type StationWithFavicon = Station & { favicon?: string };

const stationWithArt = (uuid: string, favicon?: string): StationWithFavicon => {
    const station: StationWithFavicon = { stationuuid: uuid, name: `${uuid} FM` };
    if (favicon !== undefined) station.favicon = favicon;
    return station;
};

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    resetArtworkState();
    FakeImage.instances = [];
    vi.stubGlobal('Image', FakeImage);
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith(LS_ART_PREFIX)) localStorage.removeItem(key);
    }
    state.stations = [];
    state.currentIndex = -1;
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('artwork cache — loadArtworkCache / saveArtworkCache', () => {
    it('round-trips a saved URL under the radio-browser-art-<uuid> key', () => {
        saveArtworkCache('uuid-a', ART_URL);
        saveArtworkCache('uuid-b', ART_URL_2);
        expect(loadArtworkCache('uuid-a')).toBe(ART_URL);
        expect(loadArtworkCache('uuid-b')).toBe(ART_URL_2);
        expect(localStorage.getItem(`${LS_ART_PREFIX}uuid-a`)).toBe(JSON.stringify(ART_URL));
        expect(localStorage.getItem(`${LS_ART_PREFIX}uuid-b`)).toBe(JSON.stringify(ART_URL_2));
    });

    it('returns null when the key is missing', () => {
        expect(loadArtworkCache('missing-uuid')).toBeNull();
    });

    it('returns null on invalid JSON', () => {
        localStorage.setItem(`${LS_ART_PREFIX}uuid-bad`, '{corrupt');
        expect(loadArtworkCache('uuid-bad')).toBeNull();
    });

    it.each<string>(['42', '{}', '[]'])('returns null on non-string JSON %s', (seed) => {
        localStorage.setItem(`${LS_ART_PREFIX}uuid-num`, seed);
        expect(loadArtworkCache('uuid-num')).toBeNull();
    });

    it('returns null on an empty stored string (an empty URL is never a valid cache)', () => {
        localStorage.setItem(`${LS_ART_PREFIX}uuid-empty`, JSON.stringify(''));
        expect(loadArtworkCache('uuid-empty')).toBeNull();
    });

    it('overwrites a previously saved URL (last-known-good)', () => {
        saveArtworkCache('uuid-x', ART_URL);
        saveArtworkCache('uuid-x', ART_URL_2);
        expect(loadArtworkCache('uuid-x')).toBe(ART_URL_2);
    });

    it('writes nothing for an empty URL and does not clobber a saved URL', () => {
        saveArtworkCache('uuid-x', ART_URL);
        saveArtworkCache('uuid-x', '');
        expect(loadArtworkCache('uuid-x')).toBe(ART_URL);
    });

    it('swallows a quota-exceeded write error', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('QuotaExceededError');
        });
        expect(() => saveArtworkCache('uuid-x', ART_URL)).not.toThrow();
    });

    it('keeps the uuids independent', () => {
        saveArtworkCache('uuid-a', ART_URL);
        expect(loadArtworkCache('uuid-b')).toBeNull();
    });
});

describe('resolveArtworkUrl', () => {
    it('returns the station favicon when present', () => {
        expect(resolveArtworkUrl(stationWithArt('uuid-1', ART_URL))).toBe(ART_URL);
    });

    it("returns '' when the favicon is missing or empty", () => {
        expect(resolveArtworkUrl(stationWithArt('uuid-2'))).toBe('');
        expect(resolveArtworkUrl(stationWithArt('uuid-3', ''))).toBe('');
    });
});

describe('getArtworkLoadState', () => {
    it('tracks loading → ready on Image.onload and loading → error on Image.onerror', () => {
        expect(getArtworkLoadState('http://never-requested.example/art.png')).toBe('loading');

        requestArtwork(ART_URL);
        expect(getArtworkLoadState(ART_URL)).toBe('loading');
        FakeImage.instances[0].onload?.();
        expect(getArtworkLoadState(ART_URL)).toBe('ready');

        requestArtwork(ART_URL_2);
        expect(getArtworkLoadState(ART_URL_2)).toBe('loading');
        FakeImage.instances[1].onerror?.();
        expect(getArtworkLoadState(ART_URL_2)).toBe('error');
    });
});

describe('requestArtwork', () => {
    it('is idempotent per URL — creates exactly one Image per URL', () => {
        requestArtwork(ART_URL);
        requestArtwork(ART_URL);
        expect(FakeImage.instances).toHaveLength(1);
        expect(FakeImage.instances[0].src).toBe(ART_URL);

        // already-settled URLs are never re-requested
        FakeImage.instances[0].onload?.();
        requestArtwork(ART_URL);
        expect(FakeImage.instances).toHaveLength(1);
    });
});

describe('renderArtworkSlot', () => {
    it("returns '' for an empty URL", () => {
        expect(renderArtworkSlot('')).toBe('');
    });

    it('renders a skeleton placeholder while the URL is loading', () => {
        const html = renderArtworkSlot(ART_URL_2, 'uuid-skel');
        expect(html).toContain('<span class="artwork-slot artwork-skeleton"');
        expect(html).toContain(`data-art-url="${ART_URL_2}"`);
        expect(html).toContain('data-art-uuid="uuid-skel"');
        expect(html).toContain('role="img"');
        expect(html).toContain('aria-hidden="true"');
        expect(html).not.toContain('<img');
    });

    it('renders an img with escaped src, empty alt, and lazy loading once ready', () => {
        requestArtwork(ART_URL);
        FakeImage.instances[0].onload?.();
        const html = renderArtworkSlot(ART_URL);
        expect(html).toContain('<img class="artwork-slot"');
        expect(html).toContain('src="http://cdn.example.com/art.png?a=1&amp;b=2"');
        expect(html).toContain('alt=""');
        expect(html).toContain('loading="lazy"');
        expect(html).not.toContain('onerror');
    });

    it('renders an empty slot after a failure and never an img', () => {
        requestArtwork(ART_URL);
        FakeImage.instances[0].onerror?.();
        const html = renderArtworkSlot(ART_URL);
        expect(html).toContain('<span class="artwork-slot artwork-slot--empty"');
        expect(html).not.toContain('<img');
    });
});

describe('scanArtwork', () => {
    it('requests each unrequested slot once; a settle flips the registry, fires the render hook, and caches the URL', () => {
        const hook = vi.fn();
        setRenderHook(hook);
        document.querySelector('#app')!.innerHTML =
            renderArtworkSlot(ART_URL_2, 'uuid-1') + renderArtworkSlot(ART_URL_3, 'uuid-2');

        scanArtwork();
        expect(FakeImage.instances).toHaveLength(2);
        expect(FakeImage.instances[0].src).toBe(ART_URL_2);
        expect(FakeImage.instances[1].src).toBe(ART_URL_3);

        // a second scan never re-requests in-flight slots
        scanArtwork();
        expect(FakeImage.instances).toHaveLength(2);

        // one image settles: the render hook fires once, and the settled URL
        // is cached under the slot's station uuid
        FakeImage.instances[0].onload?.();
        expect(hook).toHaveBeenCalledTimes(1);
        expect(getArtworkLoadState(ART_URL_2)).toBe('ready');
        expect(loadArtworkCache('uuid-1')).toBe(ART_URL_2);
        expect(loadArtworkCache('uuid-2')).toBeNull();
    });

    it('stale-guard: no render hook when the slot for the settled URL left the DOM', () => {
        const hook = vi.fn();
        setRenderHook(hook);
        document.querySelector('#app')!.innerHTML =
            renderArtworkSlot(ART_URL_2, 'uuid-a') + renderArtworkSlot(ART_URL_3, 'uuid-b');
        scanArtwork();
        expect(FakeImage.instances).toHaveLength(2);

        // drop only the slot carrying ART_URL_2 — ART_URL_3's slot stays
        document.querySelector('#app')!.innerHTML = renderArtworkSlot(ART_URL_3, 'uuid-b');

        FakeImage.instances[0].onload?.(); // ART_URL_2 settles with no slot → no hook
        expect(hook).not.toHaveBeenCalled();
        // the registry still updates on settle — only the re-render is gated
        expect(getArtworkLoadState(ART_URL_2)).toBe('ready');

        FakeImage.instances[1].onload?.(); // ART_URL_3 settles, its slot is live → hook
        expect(hook).toHaveBeenCalledTimes(1);
    });
});

describe('rememberStationArtwork', () => {
    it('marks the URL ready and writes the cache for a station uuid', () => {
        rememberStationArtwork('uuid-r', ART_URL_2);
        expect(getArtworkLoadState(ART_URL_2)).toBe('ready');
        expect(loadArtworkCache('uuid-r')).toBe(ART_URL_2);
        expect(localStorage.getItem(`${LS_ART_PREFIX}uuid-r`)).toBe(JSON.stringify(ART_URL_2));
    });

    it('marks the URL ready but writes no cache for an empty uuid', () => {
        rememberStationArtwork('', ART_URL_2);
        expect(getArtworkLoadState(ART_URL_2)).toBe('ready');
        for (let i = 0; i < localStorage.length; i++) {
            expect(localStorage.key(i)).not.toMatch(/^radio-browser-art-/);
        }
    });
});

describe('resetArtworkState — test seam', () => {
    it('clears the registry, forgets in-flight requests, and clears the render hook', () => {
        const hook = vi.fn();
        setRenderHook(hook);
        requestArtwork(ART_URL);
        resetArtworkState();

        // registry cleared → the URL is unknown again
        expect(getArtworkLoadState(ART_URL)).toBe('loading');
        // the in-flight request is forgotten: a fresh request starts a new Image
        requestArtwork(ART_URL);
        expect(FakeImage.instances).toHaveLength(2);
        // the hook is cleared: a settling request with a live slot no longer re-renders
        document.querySelector('#app')!.innerHTML = renderArtworkSlot(ART_URL, 'uuid-r');
        FakeImage.instances[1].onload?.();
        expect(hook).not.toHaveBeenCalled();
    });
});

describe('playingStationArtUrl', () => {
    it('prefers the current station favicon over the cache', () => {
        saveArtworkCache('uuid-p', ART_URL_3);
        state.stations = [stationWithArt('uuid-p', ART_URL_2)];
        state.currentIndex = 0;
        expect(playingStationArtUrl(state)).toBe(ART_URL_2);
    });

    it('falls back to the cached URL by station uuid when the favicon is missing', () => {
        saveArtworkCache('uuid-p', ART_URL_3);
        state.stations = [stationWithArt('uuid-p')];
        state.currentIndex = 0;
        expect(playingStationArtUrl(state)).toBe(ART_URL_3);
    });

    it("returns '' with no station, no favicon, and no cache — and never throws", () => {
        expect(() => playingStationArtUrl(state)).not.toThrow();
        expect(playingStationArtUrl(state)).toBe('');

        state.stations = [stationWithArt('uuid-p')];
        state.currentIndex = 0;
        expect(playingStationArtUrl(state)).toBe('');

        state.stations = [];
        state.currentIndex = -1;
        expect(playingStationArtUrl(state)).toBe('');
    });
});
