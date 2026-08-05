import {getLabels} from './i18n';
import type {Language} from './i18n';
import type {Mode, SortKey, Station} from './state';
import {state} from './app';
import {render, refresh, searchFromInputs, reset, loadNextResultSet, loadPreviousResultSet} from './app';
import {playStation, stopPlayback, toggleFavorite, sendToSoundtouch, setLanguage, pingSoundtouch, sanitizeHost, sendKeyPress, sendMute, scheduleVolumeSend, REMOTE_KEYS} from './actions';
import {connectSoundtouchWs, closeSoundtouchWs, requestSnapshot} from './soundtouch-ws';
import {armSendConfirmation, cancelSendConfirmation, confirmStationAlreadyPlaying} from './confirmation';
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
            if (s) {
                // FR-4: a station the device already plays never re-sends
                if (confirmStationAlreadyPlaying(s, state)) { render(); return; }
                armSendConfirmation(
                    {
                        stationName: s.name,
                        location: `/stations/byuuid/${s.stationuuid}`,
                        wasRadioBrowserPlaying: state.deviceSource === 'RADIO_BROWSER' && state.devicePlayStatus === 'PLAY_STATE',
                    },
                    getLabels(state),
                    state.soundtouchDevice?.name ?? state.soundtouchAddress
                );
                await sendToSoundtouch(s, state);
                render();
            }
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

        const remoteBtn = target.closest('#remotePlayPause, #remoteNext, #remotePrev, #remoteMute') as HTMLElement | null;
        if (remoteBtn) {
            if (state.wsStatus !== 'connected') return;
            cancelSendConfirmation();
            switch (remoteBtn.id) {
                case 'remotePlayPause': sendKeyPress(state.devicePlayStatus === 'PLAY_STATE' ? REMOTE_KEYS.pause : REMOTE_KEYS.play); break;
                // presence gating: the delegated handler must not send while
                // the device reports skipping unavailable (the button's
                // disabled attribute is bypassed by a direct dispatchEvent)
                case 'remoteNext':
                    if (!state.deviceNowPlayingDetail?.skipEnabled) return;
                    sendKeyPress(REMOTE_KEYS.next);
                    break;
                case 'remotePrev':
                    if (!state.deviceNowPlayingDetail?.skipPreviousEnabled) return;
                    sendKeyPress(REMOTE_KEYS.prev);
                    break;
                case 'remoteMute': sendMute(!state.deviceMute); break;
            }
            return;
        }

        switch (target.id) {
            case 'saveSoundtouch': {
                const raw = document.querySelector<HTMLInputElement>('#soundtouch')?.value || '';
                const host = sanitizeHost(raw);
                state.soundtouchAddress = host;
                // FR-2: the address is persisted on every save (first setup, changes, clearing)
                localStorage.setItem('radio-browser-soundtouch-host', host);
                cancelSendConfirmation();
                state.soundtouchStatus = host ? 'checking' : 'idle';
                render();
                if (host) {
                    pingSoundtouch(host).then(ok => {
                        if (state.soundtouchAddress === host) {
                            state.soundtouchStatus = ok ? 'available' : 'unreachable';
                            render();
                            if (ok) requestSnapshot();
                        }
                    });
                }
                if (host) {
                    connectSoundtouchWs(host);
                } else {
                    closeSoundtouchWs();
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
            case 'resetSettings': {
                // FR-5 consistency: resetting stops preview audio exactly like
                // toggling the switch off (previously the player bar vanished
                // while the persistent <audio> kept playing invisibly).
                const wasPreviewEnabled = state.settings.enablePreview;
                state.settings = {...defaultSettings};
                saveSettings(state.settings);
                if (wasPreviewEnabled) stopPlayback(state);
                render();
                break;
            }
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
        if (['query', 'tag'].includes(target.id)) {
            searchFromInputs();
        }
    });

    app.addEventListener('change', (e) => {
        const target = e.target as HTMLElement;
        // remote volume slider: BEFORE the filter branch — it must never trigger a search
        if (target.id === 'remoteVolume') {
            if (state.wsStatus !== 'connected') return;
            cancelSendConfirmation();
            scheduleVolumeSend(Number((target as HTMLInputElement).value));
            return;
        }
        if (['limit', 'hideBroken', 'country', 'languageFilter'].includes(target.id)) {
            searchFromInputs();
            return;
        }
        if (target.id === 'sort') {
            state.sort = (target as HTMLSelectElement).value as SortKey;
            if (state.mode === 'favorites') {
                refresh('favorites');
            } else {
                searchFromInputs();
            }
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
