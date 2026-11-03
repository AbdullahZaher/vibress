"use client";

import { useState } from "react";

/** Only HTTP(S) and same-origin root-relative asset URLs may be rendered. */
export function safePublicationImageUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const url = input.trim();
  // WHATWG URL parsing treats backslashes as slashes and can strip embedded
  // control characters. "/\\t/host" must not become a network-path URL.
  for (const character of url) {
    const code = character.charCodeAt(0);
    if (character === "\\" || code < 0x20 || code === 0x7f) return null;
  }
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const parsed = new URL(url);
    return parsed.hostname && !parsed.username && !parsed.password ? url : null;
  } catch {
    return null;
  }
}

interface PublicationBrandImageProps {
  url?: string | null | undefined;
  title: string;
  className?: string | undefined;
  /** The Default header renders its text title separately. */
  showFallbackText?: boolean | undefined;
}

/** Fallback is accessible if an asset is absent, unsafe, or fails to load. */
export function PublicationBrandImage({
  url,
  title,
  className,
  showFallbackText = true,
}: PublicationBrandImageProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const source = safePublicationImageUrl(url);
  if (!source || failedUrl === source) {
    return showFallbackText ? <span>{title}</span> : null;
  }
  return (
    <img
      src={source}
      alt={showFallbackText ? title : ""}
      className={className}
      decoding="async"
      onError={() => setFailedUrl(source)}
    />
  );
}
