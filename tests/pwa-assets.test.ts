import { describe, expect, it } from 'vitest';
// @ts-expect-error the repo has no @types/node; node:fs is available at runtime via vitest
import fs from 'node:fs';

// NOTE: Vite's transform rewrites `new URL(rel, import.meta.url)` against the
// dev-server origin, so the repo root is derived from the file URL instead
// (same precedent as tests/app.test.ts).
const repoRoot = import.meta.url.slice(0, import.meta.url.lastIndexOf('/tests/') + 1);
const INDEX_HTML = new URL('index.html', repoRoot);
const MANIFEST = new URL('public/manifest.webmanifest', repoRoot);
const PUBLIC_DIR = new URL('public/', repoRoot);
const CSS = new URL('src/styles.css', repoRoot);

function readIndexHtml(): string {
    expect(fs.existsSync(INDEX_HTML), 'missing index.html').toBe(true);
    return fs.readFileSync(INDEX_HTML, 'utf8');
}

function readManifest(): Record<string, any> {
    expect(fs.existsSync(MANIFEST), 'missing public/manifest.webmanifest').toBe(true);
    const raw = fs.readFileSync(MANIFEST, 'utf8');
    try {
        return JSON.parse(raw);
    } catch (err) {
        throw new Error(`public/manifest.webmanifest is not valid JSON: ${(err as Error).message}`);
    }
}

// Reads the IHDR dimensions (bytes 16-23, big-endian) of a PNG and validates
// the 8-byte PNG signature (89 50 4E 47 0D 0A 1A 0A) up front.
function pngDims(file: URL): { width: number; height: number } {
    const buf = fs.readFileSync(file);
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    expect(Array.from(buf.subarray(0, 8))).toEqual(signature);
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function getLinkByRel(html: string, rel: string): string | null {
    const match = html.match(new RegExp(`<link[^>]*rel="${rel}"[^>]*>`, 'i'));
    return match ? match[0] : null;
}

function listFilesRecursive(dir: URL): URL[] {
    // Directory URLs must end with "/" or URL resolution drops the last
    // segment (src/components + banner.ts -> src/banner.ts).
    const base = dir.pathname.endsWith('/') ? dir : new URL('./', dir);
    const files: URL[] = [];
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            files.push(...listFilesRecursive(new URL(`${entry.name}/`, base)));
        } else {
            files.push(new URL(entry.name, base));
        }
    }
    return files;
}

describe('web app manifest (public/manifest.webmanifest)', () => {
    it('has the full installable name', () => {
        expect(readManifest().name).toBe('AfterTouch Radio Browser');
    });

    it('has a short_name of at most 12 characters', () => {
        const manifest = readManifest();
        expect(manifest.short_name).toBe('AfterTouch');
        expect(String(manifest.short_name).length).toBeLessThanOrEqual(12);
    });

    it('keeps id, start_url and scope relative ("./" URLs)', () => {
        const manifest = readManifest();
        for (const key of ['id', 'start_url', 'scope']) {
            const value = manifest[key];
            expect(typeof value, `manifest.${key} must be a string`).toBe('string');
            expect(value, `manifest.${key} must be a relative "./" URL`).toMatch(/^\.\//);
            expect(value, `manifest.${key} must not be an absolute URL`).not.toMatch(/^https?:\/\//);
            expect(value, `manifest.${key} must not start with "/"`).not.toMatch(/^\//);
        }
    });

    it('declares display "standalone"', () => {
        expect(readManifest().display).toBe('standalone');
    });

    it('sets theme_color and background_color to the app background #f7f6f2', () => {
        const manifest = readManifest();
        expect(manifest.theme_color).toBe('#f7f6f2');
        expect(manifest.background_color).toBe('#f7f6f2');
    });

    it('declares lang "en"', () => {
        expect(readManifest().lang).toBe('en');
    });

    it('lists icons at 192x192 and 512x512 with relative PNG srcs', () => {
        const manifest = readManifest();
        expect(Array.isArray(manifest.icons)).toBe(true);
        const sizes = manifest.icons.map((icon: Record<string, any>) => icon.sizes);
        expect(sizes).toContain('192x192');
        expect(sizes).toContain('512x512');
        for (const icon of manifest.icons) {
            expect(typeof icon.src, 'every icon needs a src').toBe('string');
            expect(icon.src).toMatch(/\.png$/);
            expect(icon.type).toBe('image/png');
            expect(icon.src).not.toMatch(/^https?:\/\//);
            expect(icon.src).not.toMatch(/^\//);
        }
    });

    it('includes at least one maskable-purpose icon', () => {
        const manifest = readManifest();
        const maskable = manifest.icons.filter((icon: Record<string, any>) =>
            String(icon.purpose ?? '').includes('maskable')
        );
        expect(maskable.length).toBeGreaterThan(0);
    });
});

describe('index.html installability links', () => {
    it('links the web app manifest with a relative href', () => {
        const link = getLinkByRel(readIndexHtml(), 'manifest');
        expect(link, 'no <link rel="manifest"> in index.html').not.toBeNull();
        expect(link!).toContain('href="manifest.webmanifest"');
        expect(link!).not.toMatch(/href="\/manifest/);
        expect(link!).not.toContain('http://');
        expect(link!).not.toContain('https://');
    });

    it('has a theme-color meta matching the manifest theme_color', () => {
        expect(readIndexHtml()).toMatch(
            /<meta[^>]*name="theme-color"[^>]*content="#f7f6f2"[^>]*>/i
        );
    });

    it('links apple-touch-icon with a relative href', () => {
        const link = getLinkByRel(readIndexHtml(), 'apple-touch-icon');
        expect(link, 'no <link rel="apple-touch-icon"> in index.html').not.toBeNull();
        expect(link!).toContain('href="apple-touch-icon.png"');
        expect(link!).not.toMatch(/href="\//);
        expect(link!).not.toContain('http://');
        expect(link!).not.toContain('https://');
    });

    it('includes viewport-fit=cover in the viewport meta', () => {
        expect(readIndexHtml()).toMatch(
            /<meta[^>]*name="viewport"[^>]*content="[^"]*viewport-fit=cover[^"]*"[^>]*>/i
        );
    });

    it('keeps the exact document title (it becomes the standalone window title)', () => {
        const titles = readIndexHtml().match(/<title[^>]*>[\s\S]*?<\/title>/gi) ?? [];
        expect(titles).toHaveLength(1);
        expect(titles[0]).toBe('<title>AfterTouch radio browser</title>');
    });

    it('keeps the relative favicon href="logo.png"', () => {
        const html = readIndexHtml();
        expect(html).toMatch(/<link[^>]*rel="icon"[^>]*>/);
        expect(html).toContain('href="logo.png"');
        expect(html).not.toMatch(/href="\/logo\.png"/);
    });
});

describe('no service worker', () => {
    it('index.html contains no service worker reference', () => {
        expect(readIndexHtml()).not.toMatch(/serviceWorker|service-worker|navigator\.serviceWorker/i);
    });

    it('no src/**/*.ts file references a service worker', () => {
        const tsFiles = listFilesRecursive(new URL('src/', repoRoot)).filter((file) =>
            file.pathname.endsWith('.ts')
        );
        expect(tsFiles.length).toBeGreaterThan(0); // sanity: the walker finds the app sources
        for (const file of tsFiles) {
            expect(fs.readFileSync(file, 'utf8'), file.pathname).not.toMatch(
                /serviceWorker|service-worker/i
            );
        }
    });

    it('public/ contains no service worker file', () => {
        const entries = fs.readdirSync(PUBLIC_DIR);
        for (const entry of entries) {
            expect(entry, `unexpected service worker file in public/: ${entry}`).not.toMatch(
                /sw\.js|service-?worker/i
            );
        }
    });
});

describe('icon assets', () => {
    it('public/icon-192.png is a valid 192x192 PNG larger than 1 KB', () => {
        const icon = new URL('public/icon-192.png', repoRoot);
        expect(fs.existsSync(icon), 'missing public/icon-192.png').toBe(true);
        expect(fs.statSync(icon).size).toBeGreaterThan(1024);
        expect(pngDims(icon)).toEqual({ width: 192, height: 192 });
    });

    it('public/icon-512.png is a valid 512x512 PNG larger than 1 KB', () => {
        const icon = new URL('public/icon-512.png', repoRoot);
        expect(fs.existsSync(icon), 'missing public/icon-512.png').toBe(true);
        expect(fs.statSync(icon).size).toBeGreaterThan(1024);
        expect(pngDims(icon)).toEqual({ width: 512, height: 512 });
    });

    it('public/apple-touch-icon.png is a valid 180x180 PNG larger than 1 KB', () => {
        const icon = new URL('public/apple-touch-icon.png', repoRoot);
        expect(fs.existsSync(icon), 'missing public/apple-touch-icon.png').toBe(true);
        expect(fs.statSync(icon).size).toBeGreaterThan(1024);
        expect(pngDims(icon)).toEqual({ width: 180, height: 180 });
    });

    it('every manifest icon src resolves to an existing file in public/', () => {
        const manifest = readManifest();
        for (const icon of manifest.icons ?? []) {
            const resolved = new URL(String(icon.src), PUBLIC_DIR);
            expect(fs.existsSync(resolved), `manifest icon src missing on disk: ${icon.src}`).toBe(
                true
            );
        }
    });
});

describe('app-like polish (src/styles.css)', () => {
    function readCss(): string {
        expect(fs.existsSync(CSS), 'missing src/styles.css').toBe(true);
        return fs.readFileSync(CSS, 'utf8');
    }

    it('contains overscroll-behavior', () => {
        expect(readCss()).toContain('overscroll-behavior');
    });

    it('uses env(safe-area-inset-*) paddings', () => {
        expect(readCss()).toContain('env(safe-area-inset');
    });

    it('has a rule styling input and select with accent-color: var(--primary)', () => {
        expect(readCss()).toMatch(
            /input[^}]*select[^{]*\{[^}]*accent-color:\s*var\(--primary\)/
        );
    });

    it('has a rule on .btn with user-select: none', () => {
        expect(readCss()).toMatch(/\.btn[^{]*\{[^}]*user-select:\s*none/);
    });

    it('wraps the remote header on narrow screens (wave 7.1)', () => {
        expect(readCss()).toMatch(/\.remote-head[^{]*\{[^}]*flex-wrap:\s*wrap/);
        expect(readCss()).toMatch(/\.remote-head \.remote-status\s*\{[^}]*margin-left:\s*auto/);
    });

    it('floats the remote header device-info popover and drops the full-width-row rules (wave 7.2)', () => {
        expect(readCss()).toMatch(
            /\.soundtouch-info-body[^{]*\{[^}]*position:\s*absolute[^}]*top:\s*100%[^}]*z-index:\s*2/
        );
        expect(readCss()).not.toMatch(/\.remote-head \.soundtouch-info[^{]*\{/);
    });

    it('opens the settings popup device-info popover upward (wave 7.2)', () => {
        expect(readCss()).toMatch(
            /\.soundtouch-section \.soundtouch-info-body[^{]*\{[^}]*bottom:\s*100%[^}]*top:\s*auto[^}]*margin-top:\s*0/
        );
    });

    it('anchors the popup device-info popover past the config row and keeps the modal panel scrolling (wave 7.4)', () => {
        expect(readCss()).toMatch(/\.modal-panel \.soundtouch-info-body[^{]*\{[^}]*right:\s*-110px/);
        expect(readCss()).toMatch(/\.modal-panel[^{]*\{[^}]*overflow-y:\s*auto/);
        expect(readCss()).toMatch(/\.remote-panel[^{]*\{[^}]*margin:\s*0 0 1rem 0/);
    });

    it('keeps the header a single row with the gear top-right on small screens (FR-12)', () => {
        expect(readCss()).not.toMatch(/\.topbar\s*\{[^}]*grid-template-columns:\s*1fr\s*\}/);
        expect(readCss()).not.toMatch(/\.header-right\s*\{[^}]*justify-items:\s*start\s*\}/);
        expect(readCss()).toMatch(/\.topbar\s*\{[^}]*grid-template-columns:\s*1fr auto/);
        expect(readCss()).toMatch(/\.header-right\s*\{[^}]*justify-items:\s*end/);
    });

    it('still collapses .layout and .controls in the max-width 1024px media query (FR-12)', () => {
        expect(readCss()).toMatch(/\.layout\s*\{[^}]*grid-template-columns:\s*1fr\s*\}/);
        expect(readCss()).toMatch(/\.controls\s*\{[^}]*position:\s*static\s*\}/);
    });

    it('truncates the brand text with an ellipsis on narrow screens (FR-12)', () => {
        expect(readCss()).toMatch(/\.brand\s*\{[^}]*min-width:\s*0/);
        expect(readCss()).toMatch(/\.brand\s*>\s*div\s*\{[^}]*min-width:\s*0/);
        expect(readCss()).toMatch(/\.brand h1[^{]*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/);
        expect(readCss()).toMatch(/\.brand p[^{]*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/);
    });
});
