import type {State} from '../state';

const FOOTER_SERVICE_NAME = 'Radio Browser';
const FOOTER_SERVICE_URL = 'https://www.radio-browser.info/';

export function renderFooter(state: State, t: Record<string, string>): string {
    const serviceLink = `<a href="${FOOTER_SERVICE_URL}" target="_blank" rel="noopener">${FOOTER_SERVICE_NAME}</a>`;
    return `<footer class="footer">${t.footerAttribution.replace('{service}', serviceLink)}</footer>`;
}
