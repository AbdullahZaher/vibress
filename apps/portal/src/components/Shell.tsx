import React from "react";
import { useSite } from "../lib/site";

interface ShellProps {
  children: React.ReactNode;
  /** Vertically center the content (auth screens). */
  center?: boolean;
  /** Extra nav links (e.g. Plans / Account). */
  nav?: React.ReactNode;
}

/** Publication logo for auth cards. Renders nothing if no logo is configured. */
export function BrandLogo() {
  const site = useSite();
  if (!site?.logoUrl) return null;
  return (
    <img
      className="ap-logo"
      src={site.logoUrl}
      alt={site.title}
      decoding="async"
    />
  );
}

/** Shared portal chrome: translucent global nav + content container. */
export function Shell({ children, center = false, nav }: ShellProps) {
  const site = useSite();
  return (
    <>
      <header className="ap-nav">
        <a className="ap-brand" href="/" aria-label="Back to site">
          {site?.title ?? "\u00A0"}
        </a>
        <nav className="ap-nav-links" aria-label="Portal">
          {nav}
          <a className="ap-nav-link" href="/">
            Back to site
          </a>
        </nav>
      </header>
      <main className={center ? "ap-main ap-center" : "ap-main"}>
        {children}
      </main>
    </>
  );
}
