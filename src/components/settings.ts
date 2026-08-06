import type { State } from '../state';
import { getLabels } from '../i18n';

export function renderSettings(state: State): string {
    const t = getLabels(state);
    const s = state.settings;
    return `<div class="modal-overlay" id="settingsOverlay">
    <div class="modal-panel">
        <div class="modal-header">
            <h2>${t.settingsTitle}</h2>
            <button class="modal-close" id="closeSettings">&times;</button>
        </div>
        <div class="modal-body">
            <div class="field setting-language">
                <label for="settingLanguage">${t.settingLanguage}</label>
                <select class="select" id="settingLanguage">
                    <option value="en"${state.language === 'en' ? ' selected' : ''}>English</option>
                    <option value="de"${state.language === 'de' ? ' selected' : ''}>Deutsch</option>
                    <option value="ru"${state.language === 'ru' ? ' selected' : ''}>Русский</option>
                    <option value="ukr"${state.language === 'ukr' ? ' selected' : ''}>Українська</option>
                </select>
            </div>
            <label class="setting-row">
                <input type="checkbox" id="settingEnablePreview" ${s.enablePreview ? 'checked' : ''}>
                <span id="settingEnablePreviewLabel">${t.settingEnablePreview}</span>
            </label>
            <label class="setting-row">
                <input type="checkbox" id="settingHideRemoteSkipButtons" ${s.hideRemoteSkipButtons ? 'checked' : ''}>
                <span id="settingHideRemoteSkipButtonsLabel">${t.settingHideRemoteSkipButtons}</span>
            </label>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" id="resetSettings">${t.resetDefaults}</button>
        </div>
    </div>
</div>`;
}
