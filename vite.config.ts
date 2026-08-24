import {defineConfig} from 'vitest/config';
import {emitAppAssets} from './scripts/emit-app-assets';

export default defineConfig({
    base: '',
    plugins: [emitAppAssets()],
    test: {
        environment: 'jsdom'
    }
});
