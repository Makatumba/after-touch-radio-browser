import type { State } from '../state';
import { getLabels } from '../i18n';

export function renderSettings(state: State): string {
    const t = getLabels(state);
    const s = state.settings;
    return `<div class="modal-overlay" id="settingsOverlay"><div class="modal-panel"><div class="modal-header"><h2>${t.settingsTitle}</h2><button class="modal-close" id="closeSettings">&times;</button></div><div class="modal-body"><label class="setting-row"><input type="checkbox" id="settingDisablePlayer" ${s.disablePlayer ? 'checked' : ''}><span>${t.settingDisablePlayer}</span></label><label class="setting-row"><input type="checkbox" id="settingDisablePlayButton" ${s.disablePlayButton ? 'checked' : ''}><span>${t.settingDisablePlayButton}</span></label><label class="setting-row"><input type="checkbox" id="settingSoundtouchDefault" ${s.soundtouchDefault ? 'checked' : ''}><span>${t.settingSoundtouchDefault}</span></label></div><div class="modal-footer"><button class="btn btn-secondary" id="resetSettings">${t.resetDefaults}</button></div></div></div>`;
}
