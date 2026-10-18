import React from "react";
import type { SiteSocialLinkViewModel } from "@vibress/theme-core";

interface SocialLinksProps {
  links?: SiteSocialLinkViewModel[] | undefined;
  locale?: string | undefined;
  className?: string | undefined;
}

export function SocialLinks({ links = [], locale = "en", className }: SocialLinksProps) {
  const safeLinks = Array.isArray(links) ? links : [];
  if (safeLinks.length === 0) return null;
  const isAr = Boolean(locale && locale.toLowerCase().startsWith("ar"));
  const label = isAr ? "روابط التواصل الاجتماعي" : "Social media links";

  return React.createElement(
    "nav",
    {
      "aria-label": label,
      dir: isAr ? "rtl" : "ltr",
      className,
      style: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "10px",
      },
    },
    safeLinks.map((link) =>
      React.createElement(
        "a",
        {
          key: link.id,
          href: link.url,
          target: "_blank",
          rel: "noopener noreferrer",
          "aria-label": link.label,
          title: link.label,
          style: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "44px",
            minHeight: "44px",
            borderRadius: "50%",
            textDecoration: "none",
          },
        },
        React.createElement(
          "span",
          {
            "aria-hidden": "true",
            style: {
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              background: "#ffffff",
              border: "1px solid #d1d5db",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
            },
          },
          React.createElement("img", {
            src: link.iconUrl,
            alt: "",
            width: 18,
            height: 18,
            loading: "lazy",
            style: { display: "block", width: "18px", height: "18px" },
          }),
        ),
      ),
    ),
  );
}
