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
    // the curated set: id, name, type, module type, variant, IP, firmware —
    // parsed-but-not-displayed fields (variantMode, country, region, network
    // type, marge) and the never-parsed MAC/serial render no rows
    const nameRow = infoRow(t.deviceName, d.name);
    const typeRow = infoRow(t.deviceType, d.type);
    const moduleTypeRow = infoRow(t.deviceModuleType, d.moduleType);
    const variantRow = infoRow(t.deviceVariant, d.variant);
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
        ${ipRow}
        ${firmwareRow}
        ${idRow}
    </div>
</details>`;
}

/** Wave 7: the settings popup's SoundTouch connection section — the same
 * config block the shell bar used to carry, keyed for the popup's ids.
 * Wave 7.1: the host field sits under a label above the config row, in the
 * same .field pattern as the Language select. */
export function renderSoundtouchSettings(state: State, t: Record<string, string>): string {
    // wave 12: while speaker control is off the status line explains why
    // nothing connects — Checking…/Reachable/Unreachable cannot apply (and
    // while off no probe ever runs to change them)
    const speakerOff = !state.settings.enableSpeakerControl;
    const statusText = speakerOff ? t.speakerControlOffHint : state.soundtouchStatus === 'checking' ? `⟳ ${t.checking}` : state.soundtouchStatus === 'available' ? `✓ ${t.reachable}` : state.soundtouchStatus === 'unreachable' ? `✗ ${t.unreachable}` : '—';
    const cls = !speakerOff && state.soundtouchStatus === 'available' ? ' status-ok' : !speakerOff && state.soundtouchStatus === 'unreachable' ? ' status-err' : '';
    const hint = !state.soundtouchAddress ? `<small class="soundtouch-hint">${t.unconfiguredHint}</small>` : '';
    const msg = state.deviceMessage ? `<small class="soundtouch-hint">${state.deviceMessage}</small>` : '';
    return `<section class="soundtouch-section">
    <div class="field">
        <label for="settingSoundtouchHost">${t.soundtouchNetworkAddress}</label>
        <div class="soundtouch-config">
            <input class="input" id="settingSoundtouchHost" value="${state.soundtouchAddress}" placeholder="${t.hostPlaceholder}" />
            <button class="btn btn-secondary" id="settingSoundtouchSave">${t.save}</button>
            <span class="soundtouch-status${cls}">${statusText}</span>
            ${renderDeviceInfo(state, t)}
        </div>
    </div>
    ${hint}
    ${msg}
</section>`;
}
