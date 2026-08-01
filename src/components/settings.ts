import type { State } from '../state';
import { getLabels } from '../i18n';

export function renderSettings(state: State): string {
    const t = getLabels(state);
    const s = state.settings;
    return `<div class="modal-overlay" id="settingsOverlay"><div class="modal-panel"><div class="modal-header"><h2>${t.settingsTitle}</h2><button class="modal-close" id="closeSettings">&times;</button></div><div class="modal-body"><label class="setting-row"><input type="checkbox" id="settingEnablePreview" ${s.enablePreview ? 'checked' : ''}><span>${t.settingEnablePreview}</span></label></div><div class="modal-footer"><button class="btn btn-secondary" id="resetSettings">${t.resetDefaults}</button></div></div></div>`;
}
