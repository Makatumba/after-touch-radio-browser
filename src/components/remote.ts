import type {State} from '../state';

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const PLAY_STATUS_LABELS: Record<string, string> = {
    PLAY_STATE: 'remotePlaying',
    PAUSE_STATE: 'remotePaused',
    BUFFERING_STATE: 'remoteBuffering',
    STOP_STATE: 'remoteStopped',
};

const ICONS = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M18 6l-8.5 6L18 18V6zM6 6h2v12H6z"/></svg>',
    speakerOn: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
    speakerOff: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>'
} as const;

export function renderRemotePanel(state: State, t: Record<string, string>): string {
    const detail = state.deviceNowPlayingDetail;
    const connected = state.wsStatus === 'connected';
    const statusText = state.wsStatus === 'connecting' ? `⟳ ${t.checking}` : connected ? `✓ ${t.remoteConnected}` : state.wsStatus === 'reconnecting' ? `⟳ ${t.remoteReconnecting}` : '—';
    const statusCls = connected ? ' status-ok' : state.wsStatus === 'reconnecting' ? ' status-err' : '';
    // title fallback: track → stationName → ContentItem.itemName → no station playing
    const title = state.deviceNowPlaying || detail?.stationName || detail?.contentItem?.itemName || t.noStationPlaying;
    // artist fallback: artist → verbose description; album/source join as today
    const meta = [state.deviceArtist || detail?.description || '', state.deviceAlbum, state.deviceSource].filter(Boolean).join(' · ');
    const playStatusLabel = PLAY_STATUS_LABELS[state.devicePlayStatus];
    const playStatusChip = playStatusLabel ? `<span class="remote-playstatus">${t[playStatusLabel]}</span>` : '';
    const playing = state.devicePlayStatus === 'PLAY_STATE';
    const playPauseLabel = playing ? t.remotePause : t.remotePlay;
    const playPauseIcon = playing ? ICONS.pause : ICONS.play;
    const muteLabel = state.deviceMute ? t.remoteUnmute : t.remoteMute;
    const muteIcon = state.deviceMute ? ICONS.speakerOff : ICONS.speakerOn;
    // presence gating (per the gesellix reference): next/prev are disabled
    // while their skip flag is absent — independent of the wsStatus gate
    const nextDisabled = !connected || !detail?.skipEnabled;
    const prevDisabled = !connected || !detail?.skipPreviousEnabled;
    // artwork: art → ContentItem.containerArt; a broken/blocked image removes
    // itself via the inline onerror (error events do not bubble, so the
    // delegated listeners cannot cover them — the only inline JS in the app)
    const artUrl = detail?.art || detail?.contentItem?.containerArt || '';
    const artHtml = artUrl ? `<img class="remote-art" src="${escapeHtml(artUrl)}" alt="" onerror="this.remove()" />` : '';
    return `<section class="panel remote-panel">
    <div class="remote-head">
        <h2>${t.remoteTitle}</h2>
        <span class="remote-status${statusCls}">${statusText}</span>
    </div>
    <div class="remote-nowplaying">
        ${artHtml}
        <strong>${escapeHtml(title)}</strong>
        ${meta ? `<small>${escapeHtml(meta)}</small>` : ''}
        ${playStatusChip}
    </div>
    <div class="remote-transport">
        <button class="btn btn-secondary" id="remotePrev"${prevDisabled ? ' disabled' : ''} aria-label="${t.remotePrev}" title="${t.remotePrev}">${ICONS.prev}</button>
        <button class="btn btn-primary" id="remotePlayPause"${connected ? '' : ' disabled'} aria-label="${playPauseLabel}" title="${playPauseLabel}">${playPauseIcon}</button>
        <button class="btn btn-secondary" id="remoteNext"${nextDisabled ? ' disabled' : ''} aria-label="${t.remoteNext}" title="${t.remoteNext}">${ICONS.next}</button>
    </div>
    <div class="remote-volume">
        <label for="remoteVolume">${t.remoteVolume}</label>
        <input class="range" type="range" id="remoteVolume" min="0" max="100" value="${state.deviceVolume}"${connected ? '' : ' disabled'} />
        <span class="remote-volume-value">${state.deviceVolume}</span>
        <button class="btn btn-secondary" id="remoteMute"${connected ? '' : ' disabled'} aria-label="${muteLabel}" title="${muteLabel}">${muteIcon}</button>
    </div>
</section>`;
}
