import { describe, it, expect } from 'vitest';
import { t, webDictionary, createWebTranslator } from '../../apps/web/src/lib/i18n';
import { withMockEnv } from '@vibress/testing';

describe('Web i18n dictionary (H13)', () => {
  it('covers every user-facing key with a non-empty English value', () => {
    const requiredKeys = [
      'nav.home',
      'nav.about',
      'nav.signin',
      'nav.subscribe',
      'search.label',
      'search.thisSite',
      'menu.toggle',
      'modal.close',
      'modal.nameLabel',
      'modal.emailLabel',
      'modal.namePlaceholder',
      'modal.emailPlaceholder',
      'modal.submit',
      'modal.successTitle',
      'modal.successBody',
      'modal.alreadyMember',
      'subscribe.button',
      'subscribe.buttonSuccess',
      'subscribe.emailLabel',
      'home.heroFallback',
      'home.latest',
      'home.empty',
      'home.by',
      'home.newer',
      'home.older',
      'home.pageInfo',
      'home.latestWriting',
      'home.emptyShort',
      'home.olderArticles',
      'home.newerArticles',
      'home.tagEmpty',
      'home.authorEmpty',
      'archive.by',
      'archive.previous',
      'archive.next',
      'post.readMore',
      'post.readTime',
      'post.share',
      'post.in',
      'social.twitter',
      'social.facebook',
    ];

    const en = webDictionary.en;
    expect(en).toBeDefined();
    for (const key of requiredKeys) {
      expect(typeof en[key], `missing key "${key}"`).toBe('string');
      expect(en[key].trim().length, `empty value for "${key}"`).toBeGreaterThan(0);
    }
  });

  it('resolves known keys to English text', () => {
    expect(t('nav.subscribe')).toBe('Subscribe');
    expect(t('home.latestWriting')).toBe('Latest Writing');
    expect(t('post.readMore')).toBe('Read more');
  });

  it('interpolates pagination parameters', () => {
    expect(t('home.pageInfo', { page: 2, pages: 9 })).toBe('Page 2 of 9');
    expect(t('post.readTime', { minutes: 4 })).toBe('4 min read');
  });

  it('falls back to English for locales without a dictionary entry', () => {
    const translator = createWebTranslator('fr');
    expect(translator.t('nav.home')).toBe('Home');
  });

  it('respects SITE_LOCALE as the default locale once set', async () => {
    await withMockEnv({ SITE_LOCALE: 'de-DE' }, async () => {
      const translator = createWebTranslator();
      expect(translator.getLocale()).toBe('de-DE');
      expect(translator.t('nav.subscribe')).toBe('Subscribe');
    });
  });
});