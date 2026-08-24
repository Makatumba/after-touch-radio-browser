// @ts-expect-error the repo has no @types/node; node:fs is available at runtime via Vite/Vitest
import fs from 'node:fs';
// @ts-expect-error the repo has no @types/node; node:path is available at runtime via Vite/Vitest
import path from 'node:path';

/**
 * Wave: Cordova wrapper support — emits a stable `app-assets.json` runtime
 * manifest into the build output on every production build. The Android
 * Cordova shell fetches this manifest (cache-busted, no-store) at each cold
 * launch and injects the listed hashed CSS/JS assets from GitHub Pages into
 * its local document. See the wrapper project's README for the loader side.
 *
 * The manifest is intentionally tiny and stable-shaped:
 *   { "version": "YYYY.MM.DD.HHMM", "css": ["assets/index-<hash>.css"], "js": ["assets/index-<hash>.js"] }
 *
 * Paths are emitted exactly as the bundle names them (relative to the deploy
 * root — the web app builds with Vite `base: ''`), so the loader resolves them
 * against the manifest URL.
 *
 * NOTE: this repo carries no @types/node (see AGENTS.md); the node builtins
 * above are available at runtime through Vite/Vitest and marked accordingly.
 */

export interface AppAssetsManifest {
    version: string;
    css: string[];
    js: string[];
}

/** Structural subset of a Rollup/Vite output bundle entry we rely on. */
interface BundleNode {
    type: string;
    fileName?: string;
    isEntry?: boolean;
    viteMetadata?: {importedCss?: Set<string>};
}

/** Minimal plugin shape — structurally assignable to Vite's Plugin without
 * importing the type (vitest bundles its own vite copy, and the two Plugin
 * types are nominally incompatible in this repo's layout). */
interface EmitAppAssetsPlugin {
    name: string;
    apply: 'build';
    writeBundle: (options: {dir?: string}, bundle: Record<string, BundleNode>) => void;
}

/** UTC date+minute stamp — informational; every build gets a fresh value. */
export function manifestVersion(now: Date = new Date()): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${now.getUTCFullYear()}.${p(now.getUTCMonth() + 1)}.${p(now.getUTCDate())}.${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;
}

/**
 * Extracts the app-entry JS file and its imported CSS files from a Vite
 * (Rollup) output bundle. Works with content-hashed filenames because it
 * reads whatever the build actually emitted — never a hardcoded name.
 *
 * CSS source: the entry chunk's `viteMetadata.importedCss` when present,
 * falling back to every emitted `.css` asset (this single-page app currently
 * produces exactly one stylesheet). Throws when no entry chunk exists — a
 * manifest pointing nowhere must never be written.
 */
export function extractAppAssets(bundle: Record<string, BundleNode>): AppAssetsManifest {
    const nodes = Object.values(bundle ?? {});
    const entry = nodes.find((node) => node.type === 'chunk' && node.isEntry);
    if (!entry?.fileName) {
        throw new Error('emitAppAssets: no entry chunk found in build output — refusing to write a broken app-assets.json');
    }
    let css = [...(entry.viteMetadata?.importedCss ?? [])];
    if (css.length === 0) {
        css = nodes
            .filter((node) => node.type === 'asset' && typeof node.fileName === 'string' && node.fileName.endsWith('.css'))
            .map((node) => node.fileName as string)
            .sort();
    }
    return {version: '', css, js: [entry.fileName]};
}

/** Vite plugin: writes `<outDir>/app-assets.json` after every build. */
export function emitAppAssets(): EmitAppAssetsPlugin {
    return {
        name: 'aftertouch-emit-app-assets',
        apply: 'build',
        writeBundle(options, bundle) {
            const outDir = options.dir ?? 'dist';
            const manifest = extractAppAssets(bundle);
            const payload = JSON.stringify(
                {version: manifestVersion(), css: manifest.css, js: manifest.js},
                null,
                2
            );
            fs.writeFileSync(path.join(outDir, 'app-assets.json'), `${payload}\n`);
        }
    };
}
