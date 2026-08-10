import React from 'react';
import { ThemeSiteSettings } from '@vibress/theme-core';
import { HeaderNav } from './HeaderNav';

interface ThemeLayoutProps {
  children: React.ReactNode;
  site: ThemeSiteSettings;
  settings: Record<string, unknown>;
}

export async function ThemeLayout({ children, site, settings }: ThemeLayoutProps) {
  const accentColor = typeof settings.accentColor === 'string' ? settings.accentColor : '#ff2865';
  const siteIcon = (site as unknown as Record<string, unknown>).icon as string | undefined;

  return (
    <div data-theme="vibress-default" data-accent={accentColor}>
      <link rel="stylesheet" href="/theme-assets/vibress-default/1.0.0/casper.css?v=2" />
      <style dangerouslySetInnerHTML={{ __html: `
        :root {
          --vb-accent-color: ${accentColor};
          --brand-pink: ${accentColor};
        }
      ` }} />

      <div className="viewport">
        <HeaderNav siteTitle={site.title} siteIcon={siteIcon} />

        <div className="site-content">
          {children}
        </div>

        <footer className="site-footer-bottom outer">
          <div className="site-footer-bottom-inner inner">
            <div className="site-footer-brand">{site.title}</div>
            <div>
              <a href="#/portal/signup">Sign up</a>
            </div>
            <div>
              <a href="https://vibress.com" target="_blank" rel="noopener noreferrer">Powered by Vibress</a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
