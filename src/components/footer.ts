import type {State} from '../state';
import {translations} from '../i18n';

const FOOTER_SERVICE_NAME = 'Radio Browser';
const FOOTER_SERVICE_URL = 'https://www.radio-browser.info/';
const GITHUB_REPO_URL = 'https://github.com/Makatumba/after-touch-radio-browser';
const GITHUB_ICON =
    'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z';

function escapeAttr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderFooter(state: State, t: Record<string, string>): string {
    const serviceLink = `<a href="${FOOTER_SERVICE_URL}" target="_blank" rel="noopener">${FOOTER_SERVICE_NAME}</a>`;
    const label = t.githubRepo || translations.en.githubRepo;
    const escaped = escapeAttr(label);
    const githubLink = `<a href="${GITHUB_REPO_URL}" target="_blank" rel="noopener" class="github-link" aria-label="${escaped}" title="${escaped}"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false" width="16" height="16"><path d="${GITHUB_ICON}"></path></svg> GitHub</a>`;
    const sourceTemplate = (t as Record<string, string>).sourceCode || translations.en.sourceCode;
    const sourceHtml = sourceTemplate.replace('{github}', githubLink);
    return `<footer class="footer"><div>${t.footerAttribution.replace('{service}', serviceLink)}</div><div>${sourceHtml}</div></footer>`;
}
