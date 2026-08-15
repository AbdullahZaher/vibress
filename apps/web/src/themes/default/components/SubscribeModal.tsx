"use client";

import React, { useState, useEffect } from "react";
import { t } from "../../../lib/i18n";

interface SubscribeModalProps {
  isOpen: boolean;
  onClose: () => void;
  siteTitle: string;
}

export function SubscribeModal({
  isOpen,
  onClose,
  siteTitle,
}: SubscribeModalProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    if (isOpen) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        onClose();
      }, 2000);
    }
  };

  return (
    <div className="subscribe-modal-backdrop">
      <button
        type="button"
        className="subscribe-modal-backdrop-hit"
        onClick={onClose}
        aria-label={t("modal.close")}
        tabIndex={-1}
      />
      <div
        className="subscribe-modal-container"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="subscribe-modal-title"
      >
        <button
          className="subscribe-modal-close"
          onClick={onClose}
          aria-label={t("modal.close")}
          autoFocus
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
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>

        <h2 id="subscribe-modal-title" className="subscribe-modal-title">
          {siteTitle}
        </h2>

        {submitted ? (
          <div className="subscribe-modal-success">
            <h3>{t("modal.successTitle")}</h3>
            <p>{t("modal.successBody")}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="subscribe-modal-form">
            <div className="subscribe-modal-field">
              <label htmlFor="modal-name-input">{t("modal.nameLabel")}</label>
              <input
                id="modal-name-input"
                type="text"
                placeholder={t("modal.namePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="subscribe-modal-field">
              <label htmlFor="modal-email-input">{t("modal.emailLabel")}</label>
              <input
                id="modal-email-input"
                type="email"
                required
                placeholder={t("modal.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <button type="submit" className="subscribe-modal-submit">
              {t("modal.submit")}
            </button>

            <p className="subscribe-modal-footer-text">
              {t("modal.alreadyMember")}{" "}
              <a href="#/portal/signin">{t("nav.signin")}</a>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
