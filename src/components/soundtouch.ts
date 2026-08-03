import type {State} from '../state';

export function renderSoundtouch(state: State, t: Record<string, string>): string {
    const statusText = state.soundtouchStatus === 'checking' ? `⟳ ${t.checking}` : state.soundtouchStatus === 'available' ? `✓ ${t.reachable}` : state.soundtouchStatus === 'unreachable' ? `✗ ${t.unreachable}` : '—';
    const cls = state.soundtouchStatus === 'available' ? ' status-ok' : state.soundtouchStatus === 'unreachable' ? ' status-err' : '';
    const hint = !state.soundtouchAddress ? `<small class="soundtouch-hint">${t.unconfiguredHint}</small>` : '';
    const msg = state.deviceMessage ? `<small class="soundtouch-hint">${state.deviceMessage}</small>` : '';
    return `<section class="panel soundtouch-bar">
    <div class="soundtouch-config">
        <span>${t.soundtouchCollapsed}</span>
        <input class="input" id="soundtouch" value="${state.soundtouchAddress}" placeholder="${t.hostPlaceholder}" />
        <button class="btn btn-secondary" id="saveSoundtouch">${t.save}</button>
        <span class="soundtouch-status${cls}">${statusText}</span>
    </div>
    ${hint}
    ${msg}
</section>`;
}
