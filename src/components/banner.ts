import type {State} from '../state';

export function renderOfflineBanner(state: State, t: Record<string, string>): string {
    if (state.soundtouchStatus !== 'unreachable') return '';
    return `<div class="offline-banner" role="status">${t.offlineBanner}</div>`;
}

export function renderServiceBanner(state: State, t: Record<string, string>): string {
    if (!state.serviceUnavailable) return '';
    return `<div class="service-banner" role="status">
    <span>${t.serviceUnavailable}</span>
    <button id="reloadService" class="btn">${t.reload}</button>
</div>`;
}
