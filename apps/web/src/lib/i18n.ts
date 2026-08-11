import { createTranslator, Translator, type TranslationDictionary } from '@vibress/i18n';

export const webDictionary: TranslationDictionary = {
  en: {
    'nav.home': 'Home',
    'nav.about': 'About',
    'nav.signin': 'Sign in',
    'nav.subscribe': 'Subscribe',
    'search.label': 'Search',
    'search.thisSite': 'Search this site',
    'menu.toggle': 'Toggle menu',
    'modal.close': 'Close',
    'modal.nameLabel': 'Name',
    'modal.emailLabel': 'Email',
    'modal.namePlaceholder': 'Jamie Larson',
    'modal.emailPlaceholder': 'jamie@example.com',
    'modal.submit': 'Sign up',
    'modal.successTitle': 'Thank you for subscribing!',
    'modal.successBody': 'Check your email inbox to confirm your subscription.',
    'modal.alreadyMember': 'Already a member?',
    'subscribe.button': 'Subscribe',
    'subscribe.buttonSuccess': 'Subscribed!',
    'subscribe.emailLabel': 'Email address',
    'home.heroFallback': 'Thoughts, stories and ideas.',
    'home.latest': 'Latest',
    'home.empty': 'No published posts available yet.',
    'home.by': 'By',
    'home.newer': 'Newer Posts',
    'home.older': 'Older Posts',
    'home.pageInfo': 'Page {page} of {pages}',
    'home.latestWriting': 'Latest Writing',
    'home.emptyShort': 'No published posts yet.',
    'home.olderArticles': 'Older Articles',
    'home.newerArticles': 'Newer Articles',
    'home.tagEmpty': 'No published posts under this tag.',
    'home.authorEmpty': 'No published posts by this author.',
    'archive.by': 'by',
    'archive.previous': 'Previous',
    'archive.next': 'Next',
    'post.readMore': 'Read more',
    'post.readTime': '{minutes} min read',
    'post.share': 'Share',
    'post.in': 'in',
    'social.twitter': 'Twitter',
    'social.facebook': 'Facebook',
  },
};

const translator = createTranslator({
  locale: process.env.SITE_LOCALE || 'en',
  fallbackLocale: 'en',
  dictionary: webDictionary,
});

export function createWebTranslator(locale?: string): Translator {
  return createTranslator({
    locale: locale || process.env.SITE_LOCALE || 'en',
    fallbackLocale: 'en',
    dictionary: webDictionary,
  });
}

export function t(key: string, params?: Record<string, string | number>): string {
  return translator.t(key, params);
}