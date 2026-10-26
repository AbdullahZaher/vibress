"use client";

import React from "react";
import { t } from "../../../lib/i18n";
import { useMember } from "../../../lib/useMember";

/** Molten header member actions: Sign in / Subscribe for guests, Account for signed-in members. */
export function MemberActions() {
  const member = useMember();

  if (member) {
    return (
      <div className="vb-head-members">
        <a
          className="vb-head-btn vb-btn vb-primary-btn"
          href="/portal/#/account"
          title={member.email}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          {member.avatarUrl && (
            <img
              src={member.avatarUrl}
              alt=""
              width={22}
              height={22}
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                objectFit: "cover",
              }}
            />
          )}
          <span>{member.name || "Account"}</span>
        </a>
      </div>
    );
  }

  return (
    <div className="vb-head-members">
      <a className="vb-head-link" href="/portal/#/sign-in">
        {t("nav.signin")}
      </a>
      <a
        className="vb-head-btn vb-btn vb-primary-btn"
        href="/portal/#/sign-in"
      >
        {t("nav.subscribe")}
      </a>
    </div>
  );
}
