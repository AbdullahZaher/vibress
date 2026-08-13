'use client';

import { useEffect, useRef } from 'react';

/**
 * Privacy-safe public web traffic beacon. Fire-and-forget: failures are
 * swallowed and never affect page rendering or navigation.
 *
 * - anonymous visitor id: first-party random id in localStorage (no
 *   fingerprinting, no cookies, no auth data). The raw id is sent to the
 *   collector which stores only a keyed HMAC hash.
 * - page views are sent once per page load (and on client-side navigations
 *   via history changes); preview/draft URLs are never counted.
 * - sendBeacon with fetch(keepalive) fallback.
 */

const VISITOR_ID_KEY = 'vibress_visitor_id';
const API_URL = '/api/public/v1/analytics/events';

// Module-level dedup: ignore repeats of the same path within this window
// (React StrictMode double-mount, hydration re-renders, rapid back/forward).
let lastTracked: { path: string; at: number } | null = null;
const DEDUP_MS = 5000;

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts (self-hosted sites served over plain
  // http) where crypto.randomUUID is unavailable.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getVisitorId(): string {
  try {
    let id = window.localStorage.getItem(VISITOR_ID_KEY);
    if (!id) {
      id = randomId();
      window.localStorage.setItem(VISITOR_ID_KEY, id);
    }
    return id;
  } catch {
    // Storage unavailable (private mode/blocked) — ephemeral id per load.
    return randomId();
  }
}

function classifyPath(path: string): { event: 'post.view' | 'page.view'; path: string } {
  const m = path.match(/^\/posts\/([^/]+)/);
  if (m) return { event: 'post.view', path: `/posts/${m[1]}` };
  const p = path.match(/^\/pages\/([^/]+)/);
  if (p) return { event: 'page.view', path: `/pages/${p[1]}` };
  return { event: 'page.view', path };
}

function send(path: string, eventId: string): void {
  const visitorId = getVisitorId();
  const { event, path: cleanPath } = classifyPath(path);
  // The referrer is sent as-is; the collector decides whether it is external
  // (stored domain), same-site (ignored), or absent (Direct). Same-site
  // navigation must never be recorded as a Direct acquisition.
  const payload = JSON.stringify({
    eventId,
    event,
    path: cleanPath,
    visitorId,
    referrer: document.referrer || undefined,
  });

  try {
    if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      navigator.sendBeacon(API_URL, new Blob([payload], { type: 'application/json' }));
      return;
    }
  } catch {
    // fall through to fetch
  }
  fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
    credentials: 'omit',
  }).catch(() => {
    // Fail-open: analytics must never affect the page.
  });
}

export function AnalyticsTracker(): null {
  const sentRef = useRef(false);

  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;

    const path = window.location.pathname;
    // Never count preview/draft URLs.
    if (path.startsWith('/preview/')) return;

    const now = Date.now();
    if (lastTracked && lastTracked.path === path && now - lastTracked.at < DEDUP_MS) return;
    lastTracked = { path, at: now };

    // The eventId is generated once per logical page view and reused if this
    // same event is ever retried, so the server-side idempotency key makes a
    // duplicate delivery count exactly once.
    const eventId = randomId();
    send(path, eventId);
  }, []);

  return null;
}
