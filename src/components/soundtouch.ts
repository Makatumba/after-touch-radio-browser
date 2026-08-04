import type {State} from '../state';

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** One widget row per curated field; rendered only when its data exists. */
function infoRow(label: string, value: string | undefined): string {
    return value ? `<div class="soundtouch-info-row"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>` : '';
}

export function renderDeviceInfo(state: State, t: Record<string, string>): string {
    const d = state.soundtouchDevice;
    if (!d?.id) return '';
    // the curated set: id, name, type, module type, variant, serial, IP,
    // firmware — parsed-but-not-displayed fields (variantMode, country,
    // region, network type/MAC, marge) render no rows
    const nameRow = infoRow(t.deviceName, d.name);
    const typeRow = infoRow(t.deviceType, d.type);
    const moduleTypeRow = infoRow(t.deviceModuleType, d.moduleType);
    const variantRow = infoRow(t.deviceVariant, d.variant);
    const serialRow = infoRow(t.deviceSerial, d.serialNumber);
    const ipRow = infoRow(t.deviceIp, d.ipAddress);
    const firmwareRow = infoRow(t.deviceFirmware, d.softwareVersion);
    const idRow = infoRow(t.deviceId, d.id);
    return `<details class="soundtouch-info">
    <summary>ℹ</summary>
    <div class="soundtouch-info-body">
        ${nameRow}
        ${typeRow}
        ${moduleTypeRow}
        ${variantRow}
        ${serialRow}
        ${ipRow}
        ${firmwareRow}
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
