import type {State} from '../state';

export function renderOfflineBanner(state: State, t: Record<string, string>): string {
    if (state.soundtouchStatus !== 'unreachable') return '';
    return `<div class="offline-banner" role="status">${t.offlineBanner}</div>`;
}
