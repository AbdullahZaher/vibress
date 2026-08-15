import React from "react";
import { t } from "../../../lib/i18n";

interface HeaderNavProps {
  siteTitle: string;
  siteLogo?: string;
  settings: Record<string, unknown>;
}

export function HeaderNav({
  siteTitle,
  siteLogo,
  settings: _settings,
}: HeaderNavProps) {
  return (
    <header id="vb-head" className="vb-head vb-outer">
      <div className="vb-head-inner vb-inner">
        <div className="vb-head-brand">
          <div className="vb-head-brand-wrapper">
            <a className="vb-head-logo" href="/">
              {siteLogo ? <img src={siteLogo} alt={siteTitle} /> : siteTitle}
            </a>
          </div>
          <button
            type="button"
            className="vb-search vb-icon-btn"
            aria-label={t("search.thisSite")}
            data-vb-search
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
              width="20"
              height="20"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </button>
          <button
            type="button"
            className="vb-burger"
            aria-label={t("menu.toggle")}
          ></button>
        </div>

        <nav className="vb-head-menu">
          <ul className="nav">
            <li className="nav-home">
              <a href="/">{t("nav.home")}</a>
            </li>
            <li className="nav-about">
              <a href="/about">{t("nav.about")}</a>
            </li>
          </ul>
        </nav>

        <div className="vb-head-actions">
          <div className="vb-head-members">
            <a className="vb-head-link" href="#/portal/signin">
              {t("nav.signin")}
            </a>
            <a
              className="vb-head-btn vb-btn vb-primary-btn"
              href="#/portal/signup"
            >
              {t("nav.subscribe")}
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
