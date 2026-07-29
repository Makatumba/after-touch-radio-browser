import type {State} from '../state';

export function renderSoundtouch(state: State, t: Record<string, string>): string {
    return `<section class="panel soundtouch-bar"><div class="soundtouch-config"><span>${t.soundtouchCollapsed}</span><input class="input" id="soundtouch" value="${state.soundtouchAddress}" placeholder="192.168.1.42" /><button class="btn btn-secondary" id="saveSoundtouch">${t.save}</button></div></section>`;
}
