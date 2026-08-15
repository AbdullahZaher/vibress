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

export interface AnalyticsConfig {
  gaId?: string | undefined;
  plausibleDomain?: string | undefined;
  posthogKey?: string | undefined;
  posthogHost?: string | undefined;
}

export function AnalyticsTracker({ analytics }: { analytics?: AnalyticsConfig | undefined }): null {
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

    // Third-party scripts
    if (analytics?.gaId && typeof document !== 'undefined') {
      const script = document.createElement('script');
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(analytics.gaId)}`;
      document.head.appendChild(script);

      const initScript = document.createElement('script');
      initScript.innerHTML = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${analytics.gaId}');`;
      document.head.appendChild(initScript);
    }

    if (analytics?.plausibleDomain && typeof document !== 'undefined') {
      const script = document.createElement('script');
      script.defer = true;
      script.setAttribute('data-domain', analytics.plausibleDomain);
      script.src = 'https://plausible.io/js/script.js';
      document.head.appendChild(script);
    }

    if (analytics?.posthogKey && typeof document !== 'undefined') {
      const host = analytics.posthogHost || 'https://app.posthog.com';
      const script = document.createElement('script');
      script.innerHTML = `!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);posthog.init('${analytics.posthogKey}',{api_host:'${host}'});`;
      document.head.appendChild(script);
    }
  }, [analytics]);

  return null;
}
