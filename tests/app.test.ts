import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App, state } from '../src/app';
import { translations } from '../src/i18n';

describe('app', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    state.language = 'en';
  });
  it('exports App and renders buttons', () => {
    const html = App();
    expect(html).toContain('data-lang="de"');
    expect(html).toContain('Search stations');
  });
  it('includes translations', () => {
    expect(translations.ru.search).toContain('Искать');
    expect(translations.uk.search).toContain('Шукати');
  });
});
