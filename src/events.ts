import type {Language} from './i18n';
import type {Mode, Station} from './state';
import {state} from './app';
import {render, refresh, searchFromInputs, reset, loadNextResultSet, loadPreviousResultSet} from './app';
import {playStation, stopPlayback, toggleFavorite, sendToSoundtouch, setLanguage, pingSoundtouch} from './actions';
import {defaultSettings, saveSettings} from './settings';

export function setupEvents(): void {
    const app = document.querySelector('#app')!;

    app.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;

        const langBtn = target.closest('[data-lang]') as HTMLElement | null;
        if (langBtn) { setLanguage(langBtn.dataset.lang as Language, state); render(); return; }

        const modeBtn = target.closest('[data-mode]') as HTMLElement | null;
        if (modeBtn) { refresh(modeBtn.dataset.mode as Mode); return; }

        const playBtn = target.closest('[data-play]') as HTMLElement | null;
        if (playBtn) {
            const s = state.stations.find((x: Station) => x.stationuuid === playBtn!.dataset.play);
            if (s) {
                if (state.settings.soundtouchDefault) {
                    sendToSoundtouch(s, state).catch(console.error);
                } else {
                    playStation(s, state);
                }
                render();
            }
            return;
        }

        const favBtn = target.closest('[data-fav]') as HTMLElement | null;
        if (favBtn) {
            const s = state.stations.find((x: Station) => x.stationuuid === favBtn!.dataset.fav);
            if (s) { toggleFavorite(s, state); render(); }
            return;
        }

        const sendBtn = target.closest('[data-send]') as HTMLElement | null;
        if (sendBtn) {
            const s = state.stations.find((x: Station) => x.stationuuid === sendBtn!.dataset.send);
            if (s) sendToSoundtouch(s, state).catch(console.error);
            return;
        }

        switch (target.id) {
            case 'saveSoundtouch': {
                const host = (document.querySelector<HTMLInputElement>('#soundtouch')?.value || '').trim();
                state.soundtouchAddress = host;
                localStorage.setItem('radio-browser-soundtouch-host', host);
                state.soundtouchStatus = 'checking';
                render();
                pingSoundtouch(host).then(ok => {
                    state.soundtouchStatus = ok ? 'available' : 'unreachable';
                    render();
                });
                break;
            }
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
        if (target.id === 'settingDisablePlayer') {
            state.settings.disablePlayer = (target as HTMLInputElement).checked;
            if (state.settings.disablePlayer) stopPlayback(state);
            saveSettings(state.settings);
            render();
            return;
        }
        if (target.id === 'settingDisablePlayButton') {
            state.settings.disablePlayButton = (target as HTMLInputElement).checked;
            saveSettings(state.settings);
            render();
            return;
        }
        if (target.id === 'settingSoundtouchDefault') {
            state.settings.soundtouchDefault = (target as HTMLInputElement).checked;
            saveSettings(state.settings);
            render();
        }
    });
}
