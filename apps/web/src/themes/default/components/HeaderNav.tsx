"use client";

import React, { useState } from "react";
import { SubscribeModal } from "./SubscribeModal";
import { ThemeToggle } from "../../../components/reader/ThemeToggle";
import { t } from "../../../lib/i18n";

interface HeaderNavProps {
  siteTitle: string;
  siteIcon?: string | undefined;
  siteLogo?: string | undefined;
  primaryNav?: Array<{ label: string; url: string }> | undefined;
}

export function HeaderNav({
  siteTitle,
  siteIcon,
  siteLogo,
  primaryNav,
}: HeaderNavProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <header id="vb-head" className="vb-head outer">
        <div className="vb-head-inner inner">
          <nav className="vb-head-menu-left">
            <ul className="nav">
              {primaryNav && primaryNav.length > 0 ? (
                primaryNav.map((item, idx) => (
                  <li key={idx} className="nav-item">
                    <a href={item.url}>{item.label}</a>
                  </li>
                ))
              ) : (
                <>
                  <li className="nav-home nav-current">
                    <a href="/">{t("nav.home")}</a>
                  </li>
                  <li className="nav-about">
                    <a href="/about">{t("nav.about")}</a>
                  </li>
                </>
              )}
            </ul>
          </nav>

          <div className="vb-head-brand">
            <a className="vb-head-logo" href="/">
              {siteLogo ? (
                <img
                  src={siteLogo}
                  alt={siteTitle}
                  className="vb-head-logo-img"
                  style={{ maxHeight: "36px" }}
                />
              ) : siteIcon ? (
                <img
                  src={siteIcon}
                  alt={siteTitle}
                  className="vb-head-logo-icon"
                />
              ) : null}
              <span>{siteTitle}</span>
            </a>
          </div>

          <div className="vb-head-actions">
            <ThemeToggle />

            <button
              type="button"
              className="vb-search-btn"
              aria-label={t("search.label")}
              title={t("search.label")}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </button>

            <a href="#/portal/signin" className="vb-head-signin">
              {t("nav.signin")}
            </a>

            <button
              type="button"
              className="vb-head-subscribe-btn"
              onClick={() => setIsModalOpen(true)}
            >
              {t("nav.subscribe")}
            </button>
          </div>
        </div>
      </header>

      <SubscribeModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        siteTitle={siteTitle}
      />
    </>
  );
}
