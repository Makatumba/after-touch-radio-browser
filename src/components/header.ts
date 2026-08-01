import type {Language} from '../i18n';
import type {State} from '../state';

export function renderHeader(state: State, t: Record<string, string>): string {
    return `<header class="topbar"><div class="brand"><img class="brand-mark" src="logo.png" alt="${t.logoAlt}" width="48" height="48"><div><h1>${t.title}</h1><p>${t.subtitle}</p></div></div><div class="header-right"><button class="gear-btn" id="openSettings" title="${t.settingsTitle}">&#9881;</button><div class="lang-switcher-inline"><span>${t.active}: ${state.language}</span><div class="chips">${(['en', 'de', 'ru', 'ukr'] as Language[]).map(l => `<button class="chip ${state.language === l ? 'active' : ''}" data-lang="${l}">${l}</button>`).join('')}</div></div></div></header>`;
}
