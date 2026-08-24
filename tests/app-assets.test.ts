import {describe, expect, it} from 'vitest';
// @ts-expect-error the repo has no @types/node; node:fs is available at runtime via vitest
import fs from 'node:fs';
import {extractAppAssets, manifestVersion} from '../scripts/emit-app-assets';
import {isCordovaRuntime} from '../src/runtime';

// Repo-root resolution follows the established file-URL precedent (see
// tests/pwa-assets.test.ts).
const repoRoot = import.meta.url.slice(0, import.meta.url.lastIndexOf('/tests/') + 1);

interface BundleNode {
    type: string;
    fileName?: string;
    isEntry?: boolean;
    viteMetadata?: {importedCss?: Set<string>};
}

const bundleFrom = (nodes: BundleNode[]) =>
    Object.fromEntries(nodes.map((node, i) => [`key-${i}`, node])) as Record<string, BundleNode>;

describe('app-assets manifest extraction (Cordova wrapper support)', () => {
    it('picks the entry chunk and its importedCss metadata', () => {
        const bundle = bundleFrom([
            {type: 'chunk', fileName: 'assets/vendor-abc.js', isEntry: false},
            {
                type: 'chunk',
                fileName: 'assets/index-DtmDRd5R.js',
                isEntry: true,
                viteMetadata: {importedCss: new Set(['assets/index-D8HaaMzl.css'])}
            }
        ]);
        expect(extractAppAssets(bundle)).toEqual({
            version: '',
            css: ['assets/index-D8HaaMzl.css'],
            js: ['assets/index-DtmDRd5R.js']
        });
    });

    it('falls back to every emitted .css asset when metadata is missing', () => {
        const bundle = bundleFrom([
            {type: 'asset', fileName: 'assets/b-2.css'},
            {type: 'asset', fileName: 'assets/a-1.css'},
            {type: 'asset', fileName: 'assets/logo.svg'},
            {type: 'chunk', fileName: 'assets/index-x.js', isEntry: true}
        ]);
        expect(extractAppAssets(bundle).css).toEqual(['assets/a-1.css', 'assets/b-2.css']);
    });

    it('refuses to build a manifest without an entry chunk', () => {
        const bundle = bundleFrom([{type: 'asset', fileName: 'assets/index.css'}]);
        expect(() => extractAppAssets(bundle)).toThrow(/no entry chunk/);
    });

    it('handles a null-ish bundle defensively', () => {
        expect(() => extractAppAssets(undefined as unknown as Record<string, BundleNode>)).toThrow(/no entry chunk/);
    });

    it('manifestVersion stamps UTC date+minute in the YYYY.MM.DD.HHMM shape', () => {
        expect(manifestVersion(new Date(Date.UTC(2026, 7, 24, 9, 5)))).toBe('2026.08.24.0905');
        expect(manifestVersion()).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d{4}$/);
    });

    it('the production build emits a valid dist/app-assets.json pointing at emitted files', () => {
        // Runs against the committed build output convention (docs/ mirrors dist/
        // via npm run deploy); this assertion guards the plugin end-to-end only
        // when a local dist/ exists — skipped otherwise so `npm test` never
        // depends on having built first.
        const dist = new URL('dist/app-assets.json', repoRoot);
        if (!fs.existsSync(dist)) return; // not built yet — nothing to assert here
        const manifest = JSON.parse(fs.readFileSync(dist, 'utf8')) as {
            version: string;
            css: string[];
            js: string[];
        };
        expect(manifest.version).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d{4}$/);
        expect(manifest.js.length).toBeGreaterThan(0);
        for (const file of [...manifest.js, ...manifest.css]) {
            expect(file.startsWith('assets/')).toBe(true);
            expect(fs.existsSync(new URL(`dist/${file}`, repoRoot))).toBe(true);
        }
    });
});

describe('runtime detection (Cordova vs browser)', () => {
    const scope = globalThis as {__AFTER_TOUCH_RUNTIME__?: string; cordova?: unknown};
    let savedFlag: string | undefined;
    let savedCordova: unknown;

    function setGlobals(flag: string | undefined, cordova: unknown): void {
        if (flag === undefined) delete scope.__AFTER_TOUCH_RUNTIME__;
        else scope.__AFTER_TOUCH_RUNTIME__ = flag;
        if (cordova === undefined) delete (scope as {cordova?: unknown}).cordova;
        else scope.cordova = cordova;
    }

    function capture(): void {
        savedFlag = scope.__AFTER_TOUCH_RUNTIME__;
        savedCordova = scope.cordova;
    }

    function restore(): void {
        setGlobals(savedFlag, savedCordova);
    }

    it('is false in a plain browser environment', () => {
        capture();
        try {
            setGlobals(undefined, undefined);
            expect(isCordovaRuntime()).toBe(false);
        } finally {
            restore();
        }
    });

    it('detects the shell flag set by the local Cordova index.html', () => {
        capture();
        try {
            setGlobals('cordova', undefined);
            expect(isCordovaRuntime()).toBe(true);
        } finally {
            restore();
        }
    });

    it('detects an injected cordova global even without the flag (live read)', () => {
        capture();
        try {
            setGlobals(undefined, {platformId: 'android'});
            expect(isCordovaRuntime()).toBe(true);
        } finally {
            restore();
        }
    });
});
