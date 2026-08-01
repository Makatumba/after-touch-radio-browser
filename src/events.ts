import type {Language} from './i18n';
import type {Mode, Station} from './state';
import {state} from './app';
import {render, refresh, searchFromInputs, reset, loadNextResultSet, loadPreviousResultSet} from './app';
import {playStation, stopPlayback, toggleFavorite, sendToSoundtouch, setLanguage, pingSoundtouch, sanitizeHost} from './actions';
import {defaultSettings, saveSettings} from './settings';

export function setupEvents(): void {
    const app = document.querySelector('#app')!;

    app.addEventListener('click', async (e) => {
        const target = e.target as HTMLElement;

        const langBtn = target.closest('[data-lang]') as HTMLElement | null;
        if (langBtn) { setLanguage(langBtn.dataset.lang as Language, state); render(); return; }

        const modeBtn = target.closest('[data-mode]') as HTMLElement | null;
        if (modeBtn) { refresh(modeBtn.dataset.mode as Mode); return; }

        const playBtn = target.closest('[data-play]') as HTMLElement | null;
        if (playBtn) {
            if (!state.soundtouchAddress || state.soundtouchStatus === 'unreachable') return;
            const s = state.stations.find((x: Station) => x.stationuuid === playBtn!.dataset.play);
            if (s) { await sendToSoundtouch(s, state); render(); }
            return;
        }

        const previewBtn = target.closest('[data-preview]') as HTMLElement | null;
        if (previewBtn) {
            const s = state.stations.find((x: Station) => x.stationuuid === previewBtn!.dataset.preview);
            if (s) { playStation(s, state); render(); }
            return;
        }

        const favBtn = target.closest('[data-fav]') as HTMLElement | null;
        if (favBtn) {
            const s = state.stations.find((x: Station) => x.stationuuid === favBtn!.dataset.fav);
            if (s) { toggleFavorite(s, state); render(); }
            return;
        }

        switch (target.id) {
            case 'saveSoundtouch': {
                const raw = document.querySelector<HTMLInputElement>('#soundtouch')?.value || '';
                const host = sanitizeHost(raw);
                state.soundtouchAddress = host;
                localStorage.setItem('radio-browser-soundtouch-host', host);
                state.deviceMessage = '';
                state.soundtouchStatus = host ? 'checking' : 'idle';
                render();
                if (host) {
                    pingSoundtouch(host).then(ok => {
                        if (state.soundtouchAddress === host) {
                            state.soundtouchStatus = ok ? 'available' : 'unreachable';
                            render();
                        }
                    });
                }
                break;
            }
            case 'skipSetup':
                e.preventDefault();
                state.skippedSetup = true;
                render();
                break;
            case 'search': searchFromInputs(); break;
            case 'reset': reset(); break;
            case 'refresh': refresh(state.mode); break;
            case 'openSettings': state.showSettings = true; render(); break;
            case 'closeSettings': state.showSettings = false; render(); break;
            case 'settingsOverlay': state.showSettings = false; render(); break;
            case 'resetSettings':
                state.settings = {...defaultSettings};
                saveSettings(state.settings);
                render();
                break;
            case 'prevResults': loadPreviousResultSet(); break;
            case 'nextResults': loadNextResultSet(); break;
        }
    });

    app.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        const target = e.target as HTMLElement;
        if (ke.key === 'Escape' && state.showSettings) {
            state.showSettings = false;
            render();
            return;
        }
        if (ke.key !== 'Enter') return;
        if (['query', 'country', 'languageFilter', 'tag'].includes(target.id)) {
            searchFromInputs();
        }
    });

    app.addEventListener('change', (e) => {
        const target = e.target as HTMLElement;
        if (target.id === 'limit' || target.id === 'hideBroken') {
            searchFromInputs();
            return;
        }
        if (target.id === 'settingEnablePreview') {
            state.settings.enablePreview = (target as HTMLInputElement).checked;
            if (!state.settings.enablePreview) stopPlayback(state);
            saveSettings(state.settings);
            render();
            return;
        }
    });
}
