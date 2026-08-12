import './globals.css';
import { Metadata } from 'next';
import { getPublicSiteUrl } from '../lib/seo-helpers';
import { resolveThemeHostState, getThemeSiteSettings, getPreviewThemeIdFromHeaders } from '../lib/theme-host';

const siteName = process.env.SITE_NAME || 'Vibress';
const siteDescription = process.env.SITE_DESCRIPTION || 'Publishing Platform';
const siteUrl = getPublicSiteUrl();

export const metadata: Metadata = {
  title: {
    default: siteName,
    template: `%s | ${siteName}`,
  },
  description: siteDescription,
  metadataBase: new URL(siteUrl),
  alternates: {
    canonical: siteUrl,
  },
  openGraph: {
    title: siteName,
    description: siteDescription,
    url: siteUrl,
    siteName,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: siteName,
    description: siteDescription,
  },
};

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
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

