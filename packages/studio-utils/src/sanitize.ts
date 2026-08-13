import { parseFragment, serialize } from 'parse5';

/**
 * Shared Studio HTML sanitizer.
 *
 * This is a real HTML-parser-based allowlist sanitizer (parse5), NOT a
 * regex-based filter. It walks the parsed tree, drops disallowed elements and
 * attributes, neutralizes unsafe URLs, and re-serializes the result.
 *
 * It is the FINAL security boundary for every Studio card's public HTML:
 * card renderers produce semantic markup, and this sanitizer guarantees the
 * output contains no script execution vectors regardless of card input
 * (especially the privileged HTML card).
 */

export const STUDIO_ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'u', 's', 'del', 'sub', 'sup', 'mark', 'small',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote', 'pre', 'code',
  'a', 'img', 'figure', 'figcaption',
  'video', 'audio', 'source',
  'details', 'summary',
  'div', 'span', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'iframe',
  'input',
]);

const GLOBAL_ATTRS = new Set(['class', 'id', 'dir', 'lang', 'title', 'style', 'data-checked']);

/** Tag → allowed attributes (beyond GLOBAL_ATTRS). */
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel', 'download']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading']),
  video: new Set(['src', 'poster', 'controls', 'preload', 'loop', 'muted', 'playsinline', 'width', 'height']),
  audio: new Set(['src', 'controls', 'preload', 'loop']),
  source: new Set(['src', 'type']),
  iframe: new Set(['src', 'title', 'loading', 'allow', 'allowfullscreen']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan', 'scope']),
  ol: new Set(['start', 'type']),
  input: new Set(['type', 'checked', 'disabled']),
};

const URL_ATTRS = new Set(['href', 'src', 'poster']);
const SAFE_DATA_IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp|avif);base64,/i;

/**
 * Reject dangerous URL schemes. `blob:` is never safe in persisted/published
 * content (it only exists for the current browser session).
 */
export function isSafeProtocolUrl(url: string): boolean {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  if (
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('vbscript:') ||
    trimmed.startsWith('file:') ||
    trimmed.startsWith('blob:')
  ) {
    return false;
  }
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:')
  ) {
    return true;
  }
  if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed === '') {
    return true;
  }
  // data: images only for a small allowlist of raster formats (no SVG — SVG
  // can carry script inside <script>).
  if (SAFE_DATA_IMAGE_RE.test(trimmed)) {
    return true;
  }
  // Scheme-less relative references ("example.com/path").
  if (!trimmed.includes(':')) {
    return true;
  }
  return false;
}

/** Approved embed providers (see getEmbedProvider). */
const EMBED_HOSTS = new Set([
  'youtube.com', 'm.youtube.com', 'youtu.be',
  'youtube-nocookie.com',
  'vimeo.com', 'player.vimeo.com',
]);

export type EmbedProviderKind = 'youtube' | 'vimeo';

/**
 * Validate a URL against the embed provider allowlist and return the
 * canonical iframe URL, or null when the URL is not an approved provider.
 */
export function getEmbedProvider(url: string): { kind: EmbedProviderKind; embedUrl: string } | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  let host = u.hostname.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1);
    if (!id) return null;
    return { kind: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = u.searchParams.get('v');
    if (id) return { kind: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
    const m = u.pathname.match(/^\/embed\/([\w-]+)/);
    if (m) return { kind: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${m[1]}` };
    return null;
  }
  if (host === 'youtube-nocookie.com') {
    const m = u.pathname.match(/^\/embed\/([\w-]+)/);
    if (m) return { kind: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${m[1]}` };
    return null;
  }
  if (host === 'vimeo.com') {
    const m = u.pathname.match(/^\/(\d+)/);
    if (m) return { kind: 'vimeo', embedUrl: `https://player.vimeo.com/video/${m[1]}` };
    return null;
  }
  if (host === 'player.vimeo.com') {
    const m = u.pathname.match(/^\/video\/(\d+)/);
    if (m) return { kind: 'vimeo', embedUrl: `https://player.vimeo.com/video/${m[1]}` };
    return null;
  }
  return null;
}

export function isAllowedEmbedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, '');
  return EMBED_HOSTS.has(h);
}

function isAllowedIframeSrc(src: string): boolean {
  if (!isSafeProtocolUrl(src)) return false;
  return getEmbedProvider(src) !== null;
}

type P5Node = {
  nodeName: string;
  tagName?: string;
  namespaceURI?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: P5Node[];
  value?: string;
};

function isTextNode(node: P5Node): boolean {
  return node.nodeName === '#text';
}

function isCommentNode(node: P5Node): boolean {
  return node.nodeName === '#comment';
}

/**
 * Returns a list of replacement nodes (0 = dropped, N = flattened safe text
 * from dropped wrappers). Dropped elements keep their inline text content so
 * readable content is never destroyed (e.g. <script>alert(1)</script> becomes
 * the inert text "alert(1)").
 */
function sanitizeNode(node: P5Node): P5Node[] {
  if (isTextNode(node)) {
    return [node];
  }
  if (isCommentNode(node)) {
    return [];
  }

  const tag = (node.tagName || '').toLowerCase();
  if (!STUDIO_ALLOWED_TAGS.has(tag)) {
    const out: P5Node[] = [];
    for (const child of node.childNodes || []) {
      out.push(...sanitizeNode(child));
    }
    return out;
  }

  const attrs = (node.attrs || []).filter((attr) => {
    const name = attr.name.toLowerCase();
    if (name.startsWith('on')) return false; // event handlers
    if (name === 'style') return false; // no inline style injection
    if (name.startsWith('data-') || name === 'srcdoc' || name === 'formaction' || name === 'xlink:href') return false;

    if (name === 'class') {
      // Only allow class names that look like layout/theme classes.
      return /^[a-zA-Z0-9_-]+(\s[a-zA-Z0-9_-]+)*$/.test(attr.value || '');
    }

    const allowed = GLOBAL_ATTRS.has(name) || (TAG_ATTRS[tag] || new Set()).has(name);
    if (!allowed) return false;

    if (URL_ATTRS.has(name)) {
      const value = attr.value || '';
      if (tag === 'iframe') {
        return isAllowedIframeSrc(value);
      }
      return isSafeProtocolUrl(value);
    }
    return true;
  });

  if (tag === 'a') {
    const href = attrs.find((a) => a.name.toLowerCase() === 'href');
    if (!href || href.value.trim() === '') return [];
    // Enforce safe external-link conventions.
    const target = attrs.find((a) => a.name.toLowerCase() === 'target');
    if (target && target.value === '_blank' && !attrs.some((a) => a.name.toLowerCase() === 'rel')) {
      attrs.push({ name: 'rel', value: 'noopener noreferrer' });
    }
  }

  if (tag === 'input') {
    const typeAttr = attrs.find((a) => a.name.toLowerCase() === 'type');
    if (!typeAttr || typeAttr.value.toLowerCase() !== 'checkbox') {
      return [];
    }
  }

  if (tag === 'iframe' && !attrs.some((a) => a.name.toLowerCase() === 'src')) {
    // An iframe without a validated provider src is dropped entirely.
    return [];
  }

  const childNodes: P5Node[] = [];
  for (const child of node.childNodes || []) {
    childNodes.push(...sanitizeNode(child));
  }

  return [{
    nodeName: node.nodeName,
    tagName: tag,
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    attrs,
    childNodes,
  }];
}

/** Sanitize arbitrary HTML to the Studio allowlist. Safe content survives; every script/event/unsafe-URL vector is removed. */
export function sanitizeStudioHtml(html: string): string {
  if (!html || typeof html !== 'string') return '';
  try {
    const fragment = parseFragment(html) as unknown as P5Node;
    const childNodes: P5Node[] = [];
    for (const child of fragment.childNodes || []) {
      childNodes.push(...sanitizeNode(child));
    }
    const cleanFragment = { nodeName: '#document-fragment', childNodes } as unknown as P5Node;
    const out = serialize(cleanFragment as never);
    return out;
  } catch {
    return '';
  }
}

/** Extract plain text from HTML (used for excerpts/plain-text rendering). */
export function stripHtml(html: string): string {
  if (!html || typeof html !== 'string') return '';
  try {
    const fragment = parseFragment(html) as unknown as P5Node;
    const parts: string[] = [];
    function walk(node: P5Node) {
      if (isTextNode(node)) {
        if (node.value) parts.push(node.value);
        return;
      }
      for (const child of node.childNodes || []) walk(child);
    }
    for (const child of fragment.childNodes || []) walk(child);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}
