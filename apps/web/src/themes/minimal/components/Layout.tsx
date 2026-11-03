import { PreviewAnchor } from "../../../components/preview/PreviewAnchor";
import React from "react";
import { isValidHexColor, type ThemeSiteSettings } from "@vibress/theme-core";
import { SocialLinks } from "../../../components/SocialLinks";
import { PublicationBrandImage } from "../../../components/PublicationBrandImage";

interface ThemeLayoutProps {
  children: React.ReactNode;
  site: ThemeSiteSettings;
  settings: Record<string, unknown>;
}

export async function ThemeLayout({
  children,
  site,
  settings,
}: ThemeLayoutProps) {
  const accentColor =
    isValidHexColor(settings.accentColor) ? settings.accentColor.trim() : "#09090b";
  const typography =
    typeof settings.typography === "string"
      ? settings.typography
      : "Sans-serif";
  const footerText =
    typeof settings.footerText === "string"
      ? settings.footerText
      : "Built with Vibress.";

  const isSerif = typography === "Serif";

  return (
    <div
      className={isSerif ? "has-serif-body" : "has-sans-body"}
      data-theme="vibress-minimal"
      data-accent={accentColor}
    >
      <link
        rel="stylesheet"
        href="/theme-assets/vibress-minimal/1.0.0/source.css"
      />
      <style
        dangerouslySetInnerHTML={{
          __html: `
        :root {
          --vb-accent-color: ${accentColor};
          --accent-color: ${accentColor};
        }
      `,
        }}
      />

      <div className="vb-viewport">
        <header id="vb-navigation" className="vb-navigation vb-outer">
          <div className="vb-navigation-inner vb-inner">
            <PreviewAnchor className="vb-navigation-logo" href="/">
              <PublicationBrandImage url={site.logoUrl} title={site.title} className="vb-navigation-logo-image" />
            </PreviewAnchor>
            <nav className="vb-navigation-menu">
              <ul className="nav">
                <li className="nav-home">
                  <PreviewAnchor href="/">Home</PreviewAnchor>
                </li>
              </ul>
            </nav>
          </div>
        </header>

        {children}

        <footer className="vb-footer vb-outer">
          <div className="vb-footer-inner vb-inner">
            <div className="vb-footer-bar">
              <span className="vb-footer-logo">{site.title}</span>
              <SocialLinks links={site.socialLinks} locale={site.locale} />
              <div>{footerText}</div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
