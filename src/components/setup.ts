import type {State} from '../state';

export function renderSetup(state: State, t: Record<string, string>): string {
    return `<div class="setup-view">
    <div class="setup-panel">
        <h1>${t.setupTitle}</h1>
        <p>${t.setupIntro}</p>
        <div class="setup-form">
            <input class="input" id="soundtouch" placeholder="${t.hostPlaceholder}" />
            <button class="btn btn-primary" id="saveSoundtouch">${t.save}</button>
        </div>
        <a href="#" class="skip-setup-link" id="skipSetup">${t.setupSkip}</a>
    </div>
</div>`;
}
