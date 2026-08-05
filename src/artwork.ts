import type {State, Station} from './state';

// FR-6 station artwork: per-station favicon cache, background Image fetch, and
// skeleton/empty slot rendering. The cache mirrors the FR-1 filter-cache
// convention — the URL is stored per station under `radio-browser-art-<uuid>`
// as a JSON string, last-known-good, best-effort; a malformed or unavailable
// cache is ignored, never fatal.

const LS_ART_PREFIX = 'radio-browser-art-';

type ArtLoadState = 'loading' | 'ready' | 'error';

interface ArtEntry {
    status: ArtLoadState;
    /** The in-flight Image instance the request started; identity-checks stale
     * settles after resetArtworkState() so a discarded request can never
     * resurrect the registry. */
    image?: HTMLImageElement;
}

/** URL → load state registry. Unknown URLs are implicitly 'loading'. */
const registry = new Map<string, ArtEntry>();

let renderHook: (() => void) | null = null;

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Mirrors filter-cache semantics: null on missing/invalid/non-string/empty. */
export function loadArtworkCache(uuid: string): string | null {
    try {
        const raw = localStorage.getItem(`${LS_ART_PREFIX}${uuid}`);
        if (raw === null) return null;
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'string' || parsed === '') return null;
        return parsed;
    } catch {
        return null;
    }
}

/** Best-effort per-station cache write; an empty uuid or URL is a silent no-op,
 * otherwise the URL is stored (last-known-good overwrite). */
export function saveArtworkCache(uuid: string, url: string): void {
    if (!uuid || !url) return;
    try {
        localStorage.setItem(`${LS_ART_PREFIX}${uuid}`, JSON.stringify(url));
    } catch {
        // quota/unavailable — best-effort, never throw
    }
}

export function resolveArtworkUrl(station: Station): string {
    return station.favicon || '';
}

export function getArtworkLoadState(url: string): ArtLoadState {
    return registry.get(url)?.status ?? 'loading';
}

function findArtSlot(url: string): HTMLElement | null {
    const slots = document.querySelectorAll<HTMLElement>('[data-art-url]');
    for (const slot of slots) {
        if (slot.getAttribute('data-art-url') === url) return slot;
    }
    return null;
}

function settle(url: string, image: HTMLImageElement, status: ArtLoadState): void {
    const entry = registry.get(url);
    // a discarded (reset) request or an already-settled URL never re-applies
    if (!entry || entry.image !== image || entry.status !== 'loading') return;
    entry.status = status;
    // stale-guard: the render hook fires only while a slot for this URL is
    // still in the DOM — a settle for a station that left the view re-renders
    // nothing (the registry still updates, only the re-render is gated)
    const slot = findArtSlot(url);
    if (!slot) return;
    if (status === 'ready') {
        const uuid = slot.getAttribute('data-art-uuid');
        if (uuid) saveArtworkCache(uuid, url);
    }
    renderHook?.();
}

/** Idempotent background fetch: exactly one Image per URL (resolved at request
 * time via the plain global, never captured at module load). */
function startArtworkFetch(url: string): void {
    const image = new Image();
    registry.set(url, {status: 'loading', image});
    image.src = url;
    image.onload = () => settle(url, image, 'ready');
    image.onerror = () => settle(url, image, 'error');
}

export function requestArtwork(url: string): void {
    if (!url || registry.has(url)) return;
    startArtworkFetch(url);
}

export function setRenderHook(fn: (() => void) | null): void {
    renderHook = fn;
}

/** Persists the URL for a station and starts a real background verification:
 * an absent registry entry goes 'loading' with a fresh Image (settled through
 * the same stale-guard pipeline as requestArtwork); an in-flight or already
 * settled error entry is left untouched (a known-dead URL is never resurrected
 * into a broken image); an already-ready entry is a no-op. The cache write
 * happens at send time for a known uuid but never clobbers an already-saved
 * URL (the cached last-known-good wins over a stale fallback); an empty uuid
 * only verifies the URL. */
export function rememberStationArtwork(uuid: string, url: string): void {
    if (!url) return;
    if (!registry.has(url)) startArtworkFetch(url);
    if (uuid && loadArtworkCache(uuid) === null) saveArtworkCache(uuid, url);
}

/** '' when the URL is empty; a skeleton slot while loading; an img once ready;
 * an empty slot after a failure — never an img after a failure. */
export function renderArtworkSlot(url: string, uuid?: string): string {
    if (!url) return '';
    const loadState = getArtworkLoadState(url);
    if (loadState === 'ready') {
        return `<img class="artwork-slot" src="${escapeHtml(url)}" alt="" loading="lazy">`;
    }
    if (loadState === 'error') {
        return `<span class="artwork-slot artwork-slot--empty"></span>`;
    }
    const uuidAttr = uuid ? ` data-art-uuid="${escapeHtml(uuid)}"` : '';
    return `<span class="artwork-slot artwork-skeleton" data-art-url="${escapeHtml(url)}"${uuidAttr} role="img" aria-hidden="true"></span>`;
}

/** Walks the DOM for unrequested [data-art-url] slots and requests them
 * (requestArtwork is idempotent, so re-scanning settled/in-flight slots is a
 * no-op). */
export function scanArtwork(): void {
    const slots = document.querySelectorAll<HTMLElement>('[data-art-url]');
    for (const slot of slots) {
        const url = slot.getAttribute('data-art-url');
        if (url) requestArtwork(url);
    }
}

/** Test seam: clears the registry, forgets in-flight requests, and clears the
 * render hook. */
export function resetArtworkState(): void {
    registry.clear();
    renderHook = null;
}

/** Artwork for the currently playing station: favicon → cached URL by uuid →
 * ''; never throws. */
export function playingStationArtUrl(state: State): string {
    const station = state.stations[state.currentIndex];
    if (!station) return '';
    const favicon = resolveArtworkUrl(station);
    if (favicon) return favicon;
    return loadArtworkCache(station.stationuuid) ?? '';
}
