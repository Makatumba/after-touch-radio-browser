import type {FilterOption, State} from '../state';

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderOptions(options: FilterOption[], selected: string, allLabel: string): string {
    return `<option value="">${allLabel}</option>${options.map(o => `<option value="${escapeHtml(o.value)}"${selected === o.value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}`;
}

export function renderFilters(state: State, t: Record<string, string>): string {
    return `<aside class="panel controls"><div class="field-group"><label class="field">${t.name}<input class="input" id="query" value="${state.query}"></label><label class="field">${t.country}<select class="select" id="country">${renderOptions(state.countries, state.countryCode, t.allCountries)}</select></label><label class="field">${t.lang}<select class="select" id="languageFilter">${renderOptions(state.languages, state.langFilter, t.allLanguages)}</select></label><label class="field">${t.tag}<input class="input" id="tag" value="${state.tag}"></label><label class="field">${t.limit}<select class="select" id="limit">${[12, 24, 50, 100].map(n => `<option ${state.limit === n ? 'selected' : ''} value="${n}">${n}</option>`).join('')}</select></label><label class="checkbox-row"><input id="hideBroken" type="checkbox" ${state.hideBroken ? 'checked' : ''}/> ${t.hideBroken}</label></div><div class="actions"><button class="btn btn-primary" id="search">${t.search}</button><button class="btn btn-secondary" id="reset">${t.reset}</button></div><div class="chips"><button class="chip" data-mode="top">${t.top}</button><button class="chip" data-mode="recent">${t.recent}</button><button class="chip" data-mode="favorites">${t.favorites}</button></div></aside>`;
}
