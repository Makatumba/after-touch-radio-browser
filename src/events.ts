import {getLabels} from './i18n';
import type {Language} from './i18n';
import type {Mode, SortKey, Station} from './state';
import {state} from './app';
import {render, refresh, searchFromInputs, reset, loadNextResultSet, loadPreviousResultSet, syncPlayerBar, syncShellLanguage, syncRemotePanel, syncStationCards} from './app';
import {playStation, stopPlayback, toggleFavorite, sendToSoundtouch, setLanguage, pingSoundtouch, sanitizeHost, sendKeyPress, sendMute, scheduleVolumeSend, REMOTE_KEYS} from './actions';
import {connectSoundtouchWs, closeSoundtouchWs, requestSnapshot} from './soundtouch-ws';
import {armSendConfirmation, cancelSendConfirmation, confirmStationAlreadyPlaying} from './confirmation';
import {defaultSettings, saveSettings} from './settings';
import {mountSettingsModal, unmountSettingsModal, syncSettingsModalState, relabelSettingsModal} from './settings-modal';

// The settings popup lives inside #app, but Esc must close it from anywhere
// (focus inside the modal, or a keydown dispatched on document/body). Bound
// once per page lifetime so repeated setupEvents() calls never stack
// listeners; inert while the popup is closed.
let escapeKeydownBound = false;

/** Saves a SoundTouch host from either the first-run setup view or the
 * settings popup (wave 7): sanitize, persist, drop any pending confirmation,
 * mark the reachability check, re-render, probe the device, and (re)connect
 * the WebSocket feed. The stale-host guard keeps an in-flight ping from a
 * previous save from overwriting a newer address's result. */
function applySoundtouchHost(raw: string): void {
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
}

export function setupEvents(): void {
    const app = document.querySelector('#app')!;

    app.addEventListener('click', async (e) => {
        const target = e.target as HTMLElement;

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

        const infoSummary = target.closest('details.soundtouch-info summary') as HTMLElement | null;
        if (infoSummary) {
            // wave 7.3: the popup's device-info popover opens upward and can
            // extend above the modal panel's visible area — after the native
            // details toggle (which runs after the click dispatch) scroll the
            // rows into view. Wave 7.4: the panel keeps its native scrolling
            // (overflow-y: auto) and the popover is anchored past the config
            // row (.modal-panel .soundtouch-info-body { right: -110px }),
            // clear of the host input. Popup context only: the Remote
            // header's ℹ has no .soundtouch-section ancestor and must not
            // scroll.
            const details = infoSummary.closest<HTMLDetailsElement>('details.soundtouch-info');
            if (details?.closest('.soundtouch-section')) {
                requestAnimationFrame(() => {
                    if (details.open) details.querySelector('.soundtouch-info-body')?.scrollIntoView({ block: 'nearest' });
                });
            }
            return;
        }

        // the gear is a button whose whole content is an SVG — a real click
        // lands on the <path>/<svg> (target.id === ''), so resolve it like
        // the remote-control buttons instead of switching on target.id
        const gearBtn = target.closest('#openSettings') as HTMLElement | null;
        if (gearBtn) {
            mountSettingsModal(state);
            return;
        }

        switch (target.id) {
            case 'saveSoundtouch': {
                const raw = document.querySelector<HTMLInputElement>('#soundtouch')?.value || '';
                applySoundtouchHost(raw);
                break;
            }
            case 'settingSoundtouchSave': {
                const raw = document.querySelector<HTMLInputElement>('#settingSoundtouchHost')?.value || '';
                applySoundtouchHost(raw);
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
            case 'reloadService': refresh(state.mode); break;
            case 'closeSettings': unmountSettingsModal(); break;
            case 'settingsOverlay': unmountSettingsModal(); break;
            case 'resetSettings': {
                // FR-5 consistency: resetting stops preview audio exactly like
                // toggling the switch off (previously the player bar vanished
                // while the persistent <audio> kept playing invisibly).
                const wasPreviewEnabled = state.settings.enablePreview;
                state.settings = {...defaultSettings};
                saveSettings(state.settings);
                if (wasPreviewEnabled) stopPlayback(state);
                // Wave 5/6: only the preview UI (player bar + cards' preview
                // buttons) and the Remote panel change; the shell behind the
                // popup and the popup node itself stay untouched.
                syncPlayerBar();
                // Wave 6: the station cards re-render their preview buttons in
                // place (the popup's controls sync below).
                syncStationCards();
                // Wave 6: the restored skip-hiding default re-renders only the
                // Remote panel (the popup's controls sync below).
                syncRemotePanel();
                // the preserved popup's controls sync to the restored defaults
                // instead of being rebuilt
                syncSettingsModalState(state);
                break;
            }
            case 'prevResults': loadPreviousResultSet(); break;
            case 'nextResults': loadNextResultSet(); break;
        }
    });

    app.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        const target = e.target as HTMLElement;
        if (ke.key !== 'Enter') return;
        if (['query', 'tag'].includes(target.id)) {
            searchFromInputs();
        }
    });

    if (!escapeKeydownBound) {
        escapeKeydownBound = true;
        document.addEventListener('keydown', (e) => {
            if ((e as KeyboardEvent).key === 'Escape' && state.showSettings) {
                unmountSettingsModal();
            }
        });
    }

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
            // Wave 5/6: only the preview UI (player bar + cards' preview
            // buttons) appears/disappears — the popup and the station list
            // node behind it are preserved (no-blink contract).
            syncPlayerBar();
            syncStationCards();
            return;
        }
        if (target.id === 'settingLanguage') {
            // Wave 6: the popup select replaces the old header chips — the
            // whole UI re-labels (shell re-render + in-place popup re-label)
            // while the station list and the popup keep their nodes.
            const lang = (target as HTMLSelectElement).value as Language;
            setLanguage(lang, state);
            syncShellLanguage();
            relabelSettingsModal(state);
            document.getElementById('settingLanguage')?.focus();
            return;
        }
        if (target.id === 'settingHideRemoteSkipButtons') {
            // Wave 6: only the Remote panel's transport changes — the popup
            // and the station list behind it are preserved (no-blink contract).
            state.settings.hideRemoteSkipButtons = (target as HTMLInputElement).checked;
            saveSettings(state.settings);
            syncRemotePanel();
            return;
        }
    });
}
