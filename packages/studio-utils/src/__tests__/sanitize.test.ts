import { describe, it, expect } from 'vitest';
import { sanitizeStudioHtml, stripHtml, getEmbedProvider, isSafeProtocolUrl } from '../sanitize';
import { sanitizeHtml } from '../index';

describe('sanitizeStudioHtml — allowlist sanitizer', () => {
  it('blocks script tags entirely', () => {
    const out = sanitizeStudioHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).toContain('<p>hi</p>');
  });

  it('strips event handler attributes (onerror, onclick, onload, onmouseover)', () => {
    const out = sanitizeStudioHtml('<img src="x.png" onerror="alert(1)"><div onclick="x()" onload="y()">t</div>');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('onload');
  });

  it('neutralizes javascript: and vbscript: URLs', () => {
    const out = sanitizeStudioHtml('<a href="javascript:alert(1)">x</a><img src="vbscript:msgbox(1)">');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('vbscript:');
  });

  it('rejects blob: URLs', () => {
    const out = sanitizeStudioHtml('<img src="blob:http://localhost/x">');
    expect(out).not.toContain('blob:');
  });

  it('drops iframes without an approved provider src, keeps approved ones', () => {
    const bad = sanitizeStudioHtml('<iframe srcdoc="<script>alert(1)</script>"></iframe>');
    expect(bad).not.toContain('iframe');
    const evil = sanitizeStudioHtml('<iframe src="https://evil.example/x"></iframe>');
    expect(evil).not.toContain('iframe');
    const good = sanitizeStudioHtml('<iframe src="https://www.youtube.com/embed/abc123" allowfullscreen></iframe>');
    expect(good).toContain('iframe');
    expect(good).toContain('www.youtube.com');
  });

  it('strips style attributes and data-* attributes', () => {
    const out = sanitizeStudioHtml('<div style="position:fixed" data-x="1">t</div>');
    expect(out).not.toContain('style=');
    expect(out).not.toContain('data-x');
  });

  it('preserves safe semantic markup', () => {
    const input =
      '<p>Hello <strong>bold</strong> and <em>em</em>.</p>' +
      '<h2>Heading</h2><ul><li>one</li></ul>' +
      '<blockquote>q</blockquote><pre><code>code()</code></pre>' +
      '<figure><img src="/content/media/media/a/b.png" alt="pic"><figcaption>cap</figcaption></figure>' +
      '<video src="/v.mp4" controls preload="metadata"></video>' +
      '<audio src="/a.mp3" controls></audio>' +
      '<details><summary>s</summary><div>body</div></details>' +
      '<hr>';
    const out = sanitizeStudioHtml(input);
    for (const frag of ['<strong>bold</strong>', '<h2>Heading</h2>', '<li>one</li>', '<blockquote>', '<pre>', '<figure>', '<img src="/content/media/media/a/b.png" alt="pic">', '<video src="/v.mp4" controls', '<audio src="/a.mp3" controls', '<details>', '<summary>s</summary>', '<hr>']) {
      expect(out).toContain(frag);
    }
  });

  it('adds rel noopener for target=_blank links', () => {
    const out = sanitizeStudioHtml('<a href="https://x.com" target="_blank">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('handles malformed HTML without throwing', () => {
    expect(() => sanitizeStudioHtml('<div><span></div>')).not.toThrow();
    expect(sanitizeStudioHtml('')).toBe('');
  });
});

describe('sanitizeHtml (card captions/callouts — same robust engine)', () => {
  it('removes scripts from caption-like content', () => {
    const out = sanitizeHtml('Nice <script>alert(1)</script>caption');
    expect(out).not.toContain('script');
    expect(out).toContain('caption');
  });
});

describe('stripHtml', () => {
  it('extracts plain text from html', () => {
    expect(stripHtml('<p>Hello <strong>world</strong></p><div onclick="x">!</div>')).toBe('Hello world !');
  });
});

describe('getEmbedProvider — provider allowlist', () => {
  it('accepts youtube watch/embed/short links', () => {
    expect(getEmbedProvider('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.embedUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(getEmbedProvider('https://youtu.be/dQw4w9WgXcQ')?.embedUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(getEmbedProvider('https://www.youtube.com/embed/dQw4w9WgXcQ')?.embedUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(getEmbedProvider('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')?.kind).toBe('youtube');
  });

  it('accepts vimeo links', () => {
    expect(getEmbedProvider('https://vimeo.com/123456')?.embedUrl).toBe('https://player.vimeo.com/video/123456');
    expect(getEmbedProvider('https://player.vimeo.com/video/123456')?.kind).toBe('vimeo');
  });

  it('rejects arbitrary hosts and malformed urls', () => {
    expect(getEmbedProvider('https://evil.example/embed/x')).toBeNull();
    expect(getEmbedProvider('https://soundcloud.com/x')).toBeNull();
    expect(getEmbedProvider('not a url')).toBeNull();
    expect(getEmbedProvider('')).toBeNull();
  });
});

describe('isSafeProtocolUrl', () => {
  it('allows http/https/mailto/tel/relative', () => {
    expect(isSafeProtocolUrl('https://x.com/a.png')).toBe(true);
    expect(isSafeProtocolUrl('/content/media/x.png')).toBe(true);
    expect(isSafeProtocolUrl('#anchor')).toBe(true);
    expect(isSafeProtocolUrl('mailto:a@b.c')).toBe(true);
  });
  it('rejects dangerous schemes', () => {
    expect(isSafeProtocolUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeProtocolUrl('vbscript:x')).toBe(false);
    expect(isSafeProtocolUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeProtocolUrl('blob:http://x/abc')).toBe(false);
    expect(isSafeProtocolUrl('data:text/html,<script>')).toBe(false);
  });
  it('allows only raster data: images', () => {
    expect(isSafeProtocolUrl('data:image/png;base64,iVBOR')).toBe(true);
    expect(isSafeProtocolUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
  });
});
