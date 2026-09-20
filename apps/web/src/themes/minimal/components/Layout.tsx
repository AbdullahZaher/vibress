import React from "react";
import type { ThemeSiteSettings } from "@vibress/theme-core";
import { MemberHeaderAuth } from "../../../components/auth/MemberHeaderAuth";

interface ThemeLayoutProps {
  children: React.ReactNode;
  site: ThemeSiteSettings;
  settings: Record<string, unknown>;
}

export function ThemeLayout({
  children,
  site,
  settings,
}: ThemeLayoutProps) {
  const accentColor =
    typeof settings.accentColor === "string" ? settings.accentColor : "#09090b";
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
        }
      `,
        }}
      />

      <div className="vb-viewport">
        <header id="vb-navigation" className="vb-navigation vb-outer">
          <div className="vb-navigation-inner vb-inner" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
              <a className="vb-navigation-logo" href="/">
                {site.title}
              </a>
              <nav className="vb-navigation-menu">
                <ul className="nav">
                  <li className="nav-home">
                    <a href="/">Home</a>
                  </li>
                </ul>
              </nav>
            </div>
            <div className="vb-head-actions">
              <MemberHeaderAuth showSubscribe={false} />
            </div>
          </div>
        </header>

        {children}

        <footer className="vb-footer vb-outer">
          <div className="vb-footer-inner vb-inner">
            <div className="vb-footer-bar">
              <span className="vb-footer-logo">{site.title}</span>
              <div>{footerText}</div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
