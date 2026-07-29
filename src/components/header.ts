import type {Language} from '../i18n';
import type {State} from '../state';

export function renderHeader(state: State, t: Record<string, string>): string {
    return `<header class="topbar"><div class="brand"><div class="brand-mark"></div><div><h1>${t.title}</h1><p>${t.subtitle}</p></div></div><div class="lang-switcher-inline"><span>${t.active}: ${state.language}</span><div class="chips">${(['en', 'de', 'ru', 'ukr'] as Language[]).map(l => `<button class="chip ${state.language === l ? 'active' : ''}" data-lang="${l}">${l}</button>`).join('')}</div></div></header>`;
}
