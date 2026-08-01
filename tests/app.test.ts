import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App, render, state } from '../src/app';
import { translations } from '../src/i18n';

describe('app', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    state.language = 'en';
    state.showSettings = false;
    state.settings.disablePlayer = false;
    state.mode = 'top';
  });
  it('exports App and renders buttons', () => {
    const html = App();
    expect(html).toContain('data-lang="de"');
    expect(html).toContain('Search stations');
  });
  it('includes translations', () => {
    expect(translations.ru.search).toContain('Искать');
    expect(translations.ukr.search).toContain('Шукати');
  });

  describe('footer', () => {
    // Hardcoded expected sentence per language (NOT derived from any placeholder).
    const FOOTER_STRINGS: Record<string, string> = {
      en: 'Station data by Radio Browser',
      de: 'Senderdaten von Radio Browser',
      ru: 'Данные о станциях предоставляет Radio Browser',
      ukr: 'Дані про станції надає Radio Browser',
    };

    it('renders a footer inside the app shell', () => {
      render();
      const footer = document.querySelector('.app-shell > footer.footer');
      expect(footer).not.toBeNull();
      expect(App()).toContain('<footer class="footer">');
    });

    it('wraps only the Radio Browser brand in an anchor with the exact contract', () => {
      render();
      const footer = document.querySelector<HTMLElement>('.app-shell > footer.footer');
      expect(footer).not.toBeNull();
      const links = footer!.querySelectorAll('a');
      expect(links.length).toBe(1);
      const link = links[0];
      expect(link.getAttribute('href')).toBe('https://www.radio-browser.info/');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener');
      expect(link.id).toBe('');
      for (let i = 0; i < link.attributes.length; i++) {
        expect(link.attributes[i].name.startsWith('data-')).toBe(false);
      }
      expect(link.textContent).toBe('Radio Browser');
    });

    it('localizes the footer sentence for every language', () => {
      for (const lang of ['en', 'de', 'ru', 'ukr'] as const) {
        state.language = lang;
        render();
        const footer = document.querySelector<HTMLElement>('.app-shell > footer.footer');
        expect(footer).not.toBeNull();
        expect(footer!.textContent!.trim()).toBe(FOOTER_STRINGS[lang]);
        const link = footer!.querySelector('a');
        expect(link).not.toBeNull();
        expect(link!.textContent).toBe('Radio Browser');
      }
    });

    it('has footerAttribution in all languages with identical key sets', () => {
      for (const lang of ['en', 'de', 'ru', 'ukr'] as const) {
        expect(translations[lang].footerAttribution).toBeTruthy();
      }
      for (const lang of ['de', 'ru', 'ukr'] as const) {
        expect(Object.keys(translations[lang])).toEqual(Object.keys(translations.en));
      }
      expect(Object.keys(translations.de)).toEqual(Object.keys(translations.en));
    });

    it('keeps the persistent audio node across re-renders', () => {
      render();
      const audio1 = document.querySelector('.player #audio-widget');
      expect(audio1).not.toBeNull();
      render();
      const audio2 = document.querySelector('.player #audio-widget');
      expect(audio2).not.toBeNull();
      expect(audio1).toBe(audio2);
      expect(document.querySelector('.app-shell > footer.footer')).not.toBeNull();
    });

    it('renders the footer when the player is disabled', () => {
      state.settings.disablePlayer = true;
      render();
      expect(document.querySelector('.app-shell > footer.footer')).not.toBeNull();
      expect(document.querySelector('.player')).toBeNull();
      expect(document.querySelector('#audio-widget')).toBeNull();
    });

    it('renders the footer with the settings modal open', () => {
      state.showSettings = true;
      render();
      expect(document.querySelector('.modal-overlay')).not.toBeNull();
      expect(document.querySelector('.app-shell > footer.footer')).not.toBeNull();
    });

    it('renders the footer in every mode', () => {
      for (const mode of ['top', 'recent', 'search', 'favorites'] as const) {
        state.mode = mode;
        render();
        expect(document.querySelector('.app-shell > footer.footer')).not.toBeNull();
      }
    });
  });
});
