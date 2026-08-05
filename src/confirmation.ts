import {state} from './app';
import {getLabels} from './i18n';
import type {State, Station} from './state';

/** How long the app waits for the device to confirm a station send before showing the timeout hint. */
export const CONFIRM_TIMEOUT_MS = 15000;

/** The send awaiting live-device confirmation (FR-4). Module-local: no State fields. */
interface PendingSend {
    stationName: string;
    /** The exact `/stations/byuuid/<uuid>` the app POSTed in `/select`. */
    location: string;
    /** Whether the device was already playing a Radio Browser station at arm time. */
    wasRadioBrowserPlaying: boolean;
}

let pending: PendingSend | null = null;
let confirmTimer: ReturnType<typeof setTimeout> | null = null;

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function clearPendingTimer(): void {
    if (confirmTimer !== null) {
        clearTimeout(confirmTimer);
        confirmTimer = null;
    }
}

function clearPending(): void {
    clearPendingTimer();
    pending = null;
}

/**
 * Arms the pending send confirmation BEFORE the `/select` POST (last-write-wins:
 * a second arm replaces the previous pending record and restarts the timer). The
 * station/device interpolations are XSS-escaped here, at the write site — the
 * message is rendered raw by the soundtouch component.
 */
export function armSendConfirmation(entry: PendingSend, labels: Record<string, string>, deviceLabel: string): void {
    clearPendingTimer();
    pending = entry;
    state.deviceMessage = labels.sendingToSpeaker
        .replace('{station}', escapeHtml(entry.stationName))
        .replace('{device}', escapeHtml(deviceLabel));
    confirmTimer = setTimeout(() => {
        confirmTimer = null;
        if (!pending) return;
        pending = null;
        state.deviceMessage = getLabels(state).confirmTimeoutHint;
    }, CONFIRM_TIMEOUT_MS);
}

/**
 * Short-circuit for the play tap: the device is ALREADY playing this station
 * (`PLAY_STATE` with a matching ContentItem.location) — no POST, no message, no
 * pending send.
 */
export function confirmStationAlreadyPlaying(station: Station, state: State): boolean {
    const location = state.deviceNowPlayingDetail?.contentItem?.location ?? '';
    return state.devicePlayStatus === 'PLAY_STATE' && location === `/stations/byuuid/${station.stationuuid}`;
}

/**
 * Resolves a pending send from freshly-applied now-playing state. Called after
 * every successful applyNowPlaying (pushed `<updates>` and snapshot RESPONSEs).
 * No-op when nothing is pending. Reads state and writes only deviceMessage —
 * never issues device traffic (no echo loops). Order: M4 → M3 → M1 → M5.
 */
export function evaluateNowPlaying(): void {
    if (!pending) return;
    const labels = getLabels(state);
    const location = state.deviceNowPlayingDetail?.contentItem?.location ?? '';

    // M4: the Radio Browser source is unavailable on the device
    if (state.deviceSource === 'INVALID_SOURCE') {
        state.deviceMessage = labels.invalidSourceHint;
        clearPending();
        return;
    }
    // M3: a matching station that stops is the stream-failure signal
    if (state.devicePlayStatus === 'STOP_STATE' && location === pending.location) {
        state.deviceMessage = labels.streamFailedHint;
        clearPending();
        return;
    }
    // M1: the echoed location matches — silent confirmation
    if (location === pending.location && state.devicePlayStatus === 'PLAY_STATE') {
        state.deviceMessage = '';
        clearPending();
        return;
    }
    // M5: the device may transform the location — source + PLAY_STATE fallback,
    // only when radio was not already playing at arm time AND the echoed
    // location is not a canonical radio-browser station path (a canonical
    // location that differs from the pending one belongs to a different station)
    if (
        state.deviceSource === 'RADIO_BROWSER' &&
        state.devicePlayStatus === 'PLAY_STATE' &&
        !pending.wasRadioBrowserPlaying &&
        !location.startsWith('/stations/byuuid/')
    ) {
        state.deviceMessage = '';
        clearPending();
        return;
    }
    // M2 (BUFFERING_STATE + match) and M6 (everything else): keep waiting
}

/**
 * Cancels the pending send and its timer. With keepMessage the current
 * deviceMessage survives — for callers that write their own message right after
 * (the send-failure path).
 */
export function cancelSendConfirmation(keepMessage = false): void {
    clearPendingTimer();
    pending = null;
    if (!keepMessage) state.deviceMessage = '';
}
