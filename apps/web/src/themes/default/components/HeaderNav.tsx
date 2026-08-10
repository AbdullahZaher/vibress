'use client';

import React, { useState } from 'react';
import { SubscribeModal } from './SubscribeModal';

interface HeaderNavProps {
  siteTitle: string;
  siteIcon?: string | undefined;
}

export function HeaderNav({ siteTitle, siteIcon }: HeaderNavProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <header id="vb-head" className="vb-head outer">
        <div className="vb-head-inner inner">
          <nav className="vb-head-menu-left">
            <ul className="nav">
              <li className="nav-home nav-current"><a href="/">Home</a></li>
              <li className="nav-about"><a href="/about">About</a></li>
            </ul>
          </nav>

          <div className="vb-head-brand">
            <a className="vb-head-logo" href="/">
              {siteIcon ? (
                <img src={siteIcon} alt={siteTitle} className="vb-head-logo-icon" />
              ) : null}
              <span>{siteTitle}</span>
            </a>
          </div>

          <div className="vb-head-actions">
            <button className="vb-search-btn" aria-label="Search" title="Search">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </button>

            <a href="#/portal/signin" className="vb-head-signin">
              Sign in
            </a>

            <button
              className="vb-head-subscribe-btn"
              onClick={() => setIsModalOpen(true)}
            >
              Subscribe
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
