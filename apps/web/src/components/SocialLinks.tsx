import React from "react";
import type { SiteSocialLinkViewModel } from "@vibress/theme-core";

interface SocialLinksProps {
  links?: SiteSocialLinkViewModel[] | undefined;
  locale?: string | undefined;
  className?: string | undefined;
}

export function SocialLinks({ links = [], locale = "en", className }: SocialLinksProps) {
  if (links.length === 0) return null;
  const label = locale.toLowerCase().startsWith("ar")
    ? "روابط التواصل الاجتماعي" : "Social media links";

  return (
    <nav aria-label={label} className={className}
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
      {links.map((link) => (
        <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer"
          aria-label={link.label} title={link.label}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "40px", minHeight: "40px" }}>
          <span aria-hidden="true" style={{
            width: "30px", height: "30px", borderRadius: "50%", background: "#fff",
            border: "1px solid #d1d5db", display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
            <img src={link.iconUrl} alt="" width={18} height={18}
              style={{ display: "block", width: "18px", height: "18px" }} />
          </span>
        </a>
      ))}
    </nav>
  );
}
