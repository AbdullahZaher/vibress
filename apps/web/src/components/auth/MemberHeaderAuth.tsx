"use client";

import React, { useState, useRef, useEffect } from "react";
import { useMemberAuth } from "./MemberAuthProvider";
import { t } from "../../lib/i18n";

export interface MemberHeaderAuthProps {
  onSubscribeClick?: () => void;
  showSubscribe?: boolean;
  className?: string;
  signInClassName?: string;
  subscribeClassName?: string;
  renderCustomAuthenticated?: (member: {
    id: string;
    name: string;
    avatarUrl: string | null;
    initials?: string | undefined;
    logout: () => Promise<void>;
    account: () => void;
  }) => React.ReactNode;
}

export function MemberHeaderAuth({
  onSubscribeClick,
  showSubscribe = true,
  className = "vb-head-auth-container",
  signInClassName = "vb-head-signin",
  subscribeClassName = "vb-head-subscribe-btn",
  renderCustomAuthenticated,
}: MemberHeaderAuthProps) {
  const { status, member, logout, account, login, signup } = useMemberAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && menuOpen) {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    }

    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  if (status === "authenticated" && member) {
    if (renderCustomAuthenticated) {
      return (
        <div className={className}>
          {renderCustomAuthenticated({
            id: member.id,
            name: member.name,
            avatarUrl: member.avatarUrl || null,
            initials: member.initials,
            logout,
            account,
          })}
        </div>
      );
    }

    return (
      <div
        className={`vb-head-member-wrap ${className}`}
        style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      >
        <button
          ref={triggerRef}
          type="button"
          className="vb-head-member-trigger"
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={t("portal.account_title") || "Account menu"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "4px 8px",
            borderRadius: "20px",
            color: "inherit",
            font: "inherit",
          }}
        >
          {member.avatarUrl ? (
            <img
              src={member.avatarUrl}
              alt={member.name}
              className="vb-member-avatar"
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                objectFit: "cover",
              }}
            />
          ) : (
            <span
              className="vb-member-initials"
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                backgroundColor: "var(--vb-accent-color, #6366f1)",
                color: "#ffffff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "12px",
                fontWeight: 600,
                userSelect: "none",
              }}
            >
              {member.initials || (member.name ? Array.from(member.name)[0]?.toUpperCase() : "M")}
            </span>
          )}
          <span
            className="vb-member-name"
            style={{
              fontWeight: 500,
              fontSize: "14px",
              maxWidth: "140px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {member.name}
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transition: "transform 0.15s ease",
              transform: menuOpen ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>

        {menuOpen && (
          <div
            ref={menuRef}
            role="menu"
            aria-orientation="vertical"
            className="vb-head-member-dropdown"
            style={{
              position: "absolute",
              top: "100%",
              insetInlineEnd: 0,
              marginTop: "8px",
              minWidth: "180px",
              backgroundColor: "#ffffff",
              color: "#1e293b",
              borderRadius: "8px",
              boxShadow:
                "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
              border: "1px solid #e2e8f0",
              padding: "4px 0",
              zIndex: 1000,
            }}
          >
            <div
              style={{
                padding: "8px 16px",
                borderBottom: "1px solid #f1f5f9",
                fontSize: "12px",
                color: "#64748b",
              }}
            >
              <div style={{ fontWeight: 600, color: "#0f172a", fontSize: "13px" }}>
                {member.name}
              </div>
            </div>

            <button
              role="menuitem"
              type="button"
              className="vb-dropdown-item"
              onClick={() => {
                setMenuOpen(false);
                account();
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "8px 16px",
                textAlign: "start",
                background: "none",
                border: "none",
                fontSize: "13px",
                color: "#334155",
                cursor: "pointer",
              }}
            >
              {t("portal.account_title") || "Account"}
            </button>

            <button
              role="menuitem"
              type="button"
              className="vb-dropdown-item"
              onClick={async () => {
                setMenuOpen(false);
                await logout();
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "8px 16px",
                textAlign: "start",
                background: "none",
                border: "none",
                fontSize: "13px",
                color: "#be123c",
                cursor: "pointer",
                borderTop: "1px solid #f1f5f9",
              }}
            >
              {t("portal.sign_out") || "Sign out"}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Unauthenticated presentation
  return (
    <div
      className={`vb-head-auth-actions ${className}`}
      style={{ display: "inline-flex", alignItems: "center", gap: "12px" }}
    >
      <a
        href="/portal/#/signin"
        onClick={(e) => {
          e.preventDefault();
          login();
        }}
        className={signInClassName}
      >
        {t("nav.signin")}
      </a>

      {showSubscribe && (
        <button
          type="button"
          className={subscribeClassName}
          onClick={() => {
            if (onSubscribeClick) {
              onSubscribeClick();
            } else {
              signup();
            }
          }}
        >
          {t("nav.subscribe")}
        </button>
      )}
    </div>
  );
}
