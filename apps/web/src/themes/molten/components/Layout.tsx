import React from 'react';
import { ThemeSiteSettings } from '@vibress/theme-core';
import { HeaderNav } from './HeaderNav';

interface ThemeLayoutProps {
  children: React.ReactNode;
  site: ThemeSiteSettings;
  settings: Record<string, unknown>;
  bodyClass?: string;
}

export function ThemeLayout({ children, site, settings, bodyClass = '' }: ThemeLayoutProps) {
  const accentColor = typeof settings.accentColor === 'string' ? settings.accentColor : '#f05230';
  const siteIcon = (site as unknown as Record<string, unknown>).icon as string | undefined;
  
  const navLayout = settings.navigationLayout === 'Logo on the left' 
    ? 'left-logo' 
    : settings.navigationLayout === 'Logo in the middle' 
      ? 'middle-logo' 
      : 'stacked';

  const titleFont = settings.titleFont === 'Elegant serif' ? 'has-serif-title' : '';
  const bodyFont = settings.bodyFont === 'Elegant serif' ? 'has-serif-body' : '';

  return (
    <div data-theme="vibress-molten" data-accent={accentColor} className={`is-head-${navLayout} ${titleFont} ${bodyFont} ${bodyClass}`}>
      <link rel="stylesheet" href="/theme-assets/vibress-molten/1.0.0/screen.css" />
      <style dangerouslySetInnerHTML={{ __html: `
        :root {
          --vb-accent-color: ${accentColor};
          --brand-pink: ${accentColor};
        }
      ` }} />

      <div className="vb-site">
        <HeaderNav siteTitle={site.title} siteLogo={siteIcon || ''} settings={settings} />

        <div className="site-content">
          {children}
        </div>

        <footer className="vb-foot vb-outer">
          <div className="vb-foot-inner vb-inner">
            <div className="vb-copyright">
              {site.title} © {new Date().getFullYear()}
            </div>
            <div className="vb-foot-center">
              <div className="vb-social-links">
                {/* Simplified social links for Vibress */}
                <a href="https://x.com" target="_blank" rel="noopener noreferrer" aria-label="Twitter">
                  <span>Twitter</span>
                </a>
                <a href="https://facebook.com" target="_blank" rel="noopener noreferrer" aria-label="Facebook">
                  <span>Facebook</span>
                </a>
              </div>
            </div>
            <div className="vb-powered-by">
              Powered by <a href="https://vibress.com/" target="_blank" rel="noopener noreferrer">Vibress</a>
            </div>
          </div>
        </footer>
      </div>
      
      <script src="/theme-assets/vibress-molten/1.0.0/main.min.js"></script>
    </div>
  );
}
