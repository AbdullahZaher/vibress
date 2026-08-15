import './globals.css';
import { Metadata } from 'next';
import { getPublicSiteUrl } from '../lib/seo-helpers';
import { resolveThemeHostState, getThemeSiteSettings, getPreviewThemeIdFromHeaders } from '../lib/theme-host';
import { AnalyticsTracker } from '../components/analytics-tracker';
import { HeadCodeInjection } from '../components/HeadCodeInjection';

const siteName = process.env.SITE_NAME || 'Vibress';
const siteDescription = process.env.SITE_DESCRIPTION || 'Publishing Platform';
const siteUrl = getPublicSiteUrl();

export async function generateMetadata(): Promise<Metadata> {
  const site = await getThemeSiteSettings();
  const title = site.title || process.env.SITE_NAME || 'Vibress';
  const description = site.description || process.env.SITE_DESCRIPTION || 'Publishing Platform';
  const siteUrl = site.url || getPublicSiteUrl();

  return {
    title: {
      default: title,
      template: `%s | ${title}`,
    },
    description,
    metadataBase: new URL(siteUrl),
    alternates: {
      canonical: siteUrl,
    },
    icons: site.iconUrl ? [{ url: site.iconUrl }] : undefined,
    openGraph: {
      title,
      description,
      url: siteUrl,
      siteName: title,
      type: 'website',
      images: site.coverUrl ? [{ url: site.coverUrl }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: site.coverUrl ? [site.coverUrl] : undefined,
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolve active theme (or preview theme) at the layout level.
  const previewThemeId = await getPreviewThemeIdFromHeaders();

  let hostState;
  try {
    hostState = await resolveThemeHostState(!!previewThemeId, previewThemeId);
  } catch {
    hostState = null;
  }

  const site = await getThemeSiteSettings();
  const themeCss = hostState?.theme.cssPath || '/theme-assets/vibress-default/1.0.0/default.css';

  return (
    <html lang={site.locale} suppressHydrationWarning>
      <head>
        <link rel="stylesheet" href={themeCss} />
        {site.code?.headerCode && (
          <HeadCodeInjection code={site.code.headerCode} />
        )}
      </head>
      <body suppressHydrationWarning>
        {site.announcementEnabled && site.announcementText && (
          <div
            id="vb-announcement-bar"
            style={{
              backgroundColor: site.accentColor || '#6366f1',
              color: '#ffffff',
              textAlign: 'center',
              padding: '10px 16px',
              fontSize: '14px',
              fontWeight: '500',
              zIndex: 9999,
              position: 'relative',
            }}
          >
            {site.announcementUrl ? (
              <a
                href={site.announcementUrl}
                style={{ color: '#ffffff', textDecoration: 'underline' }}
              >
                {site.announcementText}
              </a>
            ) : (
              site.announcementText
            )}
          </div>
        )}
        {children}
        {site.code?.footerCode && (
          <div dangerouslySetInnerHTML={{ __html: site.code.footerCode }} />
        )}
        <AnalyticsTracker analytics={site.analytics} />
      </body>
    </html>
  );
}

