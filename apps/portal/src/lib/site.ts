import { useEffect, useState } from "react";

export interface PortalSite {
  title: string;
  logoUrl: string;
}

const STORAGE_KEY = "vibress_portal_site";
let cached: PortalSite | null = null;
let inflight: Promise<PortalSite | null> | null = null;

function readStored(): PortalSite | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PortalSite) : null;
  } catch {
    return null;
  }
}

function load(): Promise<PortalSite | null> {
  if (!inflight) {
    inflight = fetch("/api/content/v1/site")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const site = data?.site;
        if (!site || typeof site.title !== "string") return null;
        cached = {
          title: site.title,
          logoUrl: typeof site.logoUrl === "string" ? site.logoUrl : "",
        };
        try {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
        } catch {
          // ignore storage errors
        }
        return cached;
      })
      .catch(() => null);
  }
  return inflight;
}

/** Site title + publication logo from site settings (cached to avoid flicker). */
export function useSite(): PortalSite | null {
  const [site, setSite] = useState<PortalSite | null>(
    () => cached ?? readStored(),
  );

  useEffect(() => {
    let alive = true;
    load().then((s) => {
      if (alive && s) setSite(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (site?.title) document.title = site.title;
  }, [site?.title]);

  return site;
}
