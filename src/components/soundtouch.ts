import type {State} from '../state';

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderDeviceInfo(state: State, t: Record<string, string>): string {
    const d = state.soundtouchDevice;
    if (!d?.id) return '';
    const nameRow = d.name ? `<div class="soundtouch-info-row"><span>${t.deviceName}</span><strong>${escapeHtml(d.name)}</strong></div>` : '';
    const typeRow = d.type ? `<div class="soundtouch-info-row"><span>${t.deviceType}</span><strong>${escapeHtml(d.type)}</strong></div>` : '';
    const idRow = `<div class="soundtouch-info-row"><span>${t.deviceId}</span><strong>${escapeHtml(d.id)}</strong></div>`;
    return `<details class="soundtouch-info">
    <summary>ℹ</summary>
    <div class="soundtouch-info-body">
        ${nameRow}
        ${typeRow}
        ${idRow}
    </div>
</details>`;
}

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
        ${renderDeviceInfo(state, t)}
    </div>
    ${hint}
    ${msg}
</section>`;
}
