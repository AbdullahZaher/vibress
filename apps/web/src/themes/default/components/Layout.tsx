import { PreviewAnchor } from "../../../components/preview/PreviewAnchor";
import React from "react";
import { ThemeSiteSettings } from "@vibress/theme-core";
import { HeaderNav } from "./HeaderNav";
import { getPreviewNavigation } from "../../../lib/preview-link-server";
import { SocialLinks } from "../../../components/SocialLinks";

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
  const extendedSite = site as unknown as Record<string, unknown>;
  const accentColor =
    typeof extendedSite.accentColor === "string" && extendedSite.accentColor
      ? (extendedSite.accentColor as string)
      : typeof settings.accentColor === "string"
        ? settings.accentColor
        : "#ff2865";
  const siteIcon = (extendedSite.iconUrl || extendedSite.icon) as
    string | undefined;
  const siteLogo = extendedSite.logoUrl as string | undefined;
  const primaryNav = extendedSite.primaryNav as
    Array<{ label: string; url: string }> | undefined;
  const secondaryNav = extendedSite.secondaryNav as
    Array<{ label: string; url: string }> | undefined;

  const previewNavigation = await getPreviewNavigation();

  return (
    <div data-theme="vibress-default" data-accent={accentColor}>
      <link
        rel="stylesheet"
        href="/theme-assets/vibress-default/1.0.0/casper.css?v=2"
      />
      <style
        dangerouslySetInnerHTML={{
          __html: `
        :root {
          --vb-accent-color: ${accentColor};
          --accent-color: ${accentColor};
          --brand-pink: ${accentColor};
          --brand-pink-hover: ${accentColor};
        }
      `,
        }}
      />

      <div className="viewport">
        <HeaderNav
          siteTitle={site.title}
          previewNavigation={previewNavigation}
          siteIcon={siteIcon}
          siteLogo={siteLogo}
          primaryNav={primaryNav}
        />

        <div className="site-content">{children}</div>

        <footer className="site-footer-bottom outer">
          <div className="site-footer-bottom-inner inner">
            <div className="site-footer-brand">{site.title}</div>
            {secondaryNav && secondaryNav.length > 0 ? (
              <div
                className="site-footer-nav"
                style={{ display: "flex", gap: "16px" }}
              >
                {secondaryNav.map((item, idx) => (
                  <PreviewAnchor key={idx} href={item.url}>
                    {item.label}
                  </PreviewAnchor>
                ))}
              </div>
            ) : null}
            <SocialLinks links={site.socialLinks} locale={site.locale} />
            <div>
              <PreviewAnchor href="/portal/#/sign-in">Sign up</PreviewAnchor>
            </div>
            <div>
              <PreviewAnchor
                href="https://vibress.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                Powered by Vibress
              </PreviewAnchor>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
