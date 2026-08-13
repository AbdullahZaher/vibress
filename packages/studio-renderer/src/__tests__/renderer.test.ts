import { describe, it, expect } from 'vitest';
import { renderStudioDocumentToHtml, renderStudioDocumentToPlainText } from '../index';
import { XSS_TEST_PAYLOADS } from '@vibress/studio-testing';

function doc(children: unknown[]): unknown {
  return { schema: 'vibress-studio', version: 1, root: { type: 'root', children } };
}

function card(cardType: string, cardData: Record<string, unknown>, type = 'studio-card'): unknown {
  return { type, cardType, cardData, version: 1 };
}

describe('renderStudioDocumentToHtml — all Studio cards', () => {
  it('renders text/heading/list/link/code', () => {
    const html = renderStudioDocumentToHtml(doc([
      { type: 'paragraph', children: [{ type: 'text', text: 'Hello ', format: 1, mode: 'normal', version: 1 }, { type: 'text', text: 'world', format: 0, mode: 'normal', version: 1 }], version: 1 },
      { type: 'heading', tag: 'h2', children: [{ type: 'text', text: 'Sub', format: 0, mode: 'normal', version: 1 }], version: 1 },
      { type: 'list', listType: 'bullet', children: [{ type: 'listitem', children: [{ type: 'text', text: 'item', format: 0, mode: 'normal', version: 1 }], version: 1 }], version: 1 },
      { type: 'link', url: 'https://example.com', children: [{ type: 'text', text: 'link', format: 0, mode: 'normal', version: 1 }], version: 1 },
    ]));
    expect(html).toContain('<strong>Hello </strong>');
    expect(html).toContain('world');
    expect(html).toContain('<h2>Sub</h2>');
    expect(html).toContain('<li>item</li>');
    expect(html).toContain('<a href="https://example.com">link</a>');
  });

  it('renders image card', () => {
    const html = renderStudioDocumentToHtml(doc([
      card('image', { src: '/content/media/a/b.png', alt: 'Alt text', caption: 'A caption', width: 'wide' }),
    ]));
    expect(html).toContain('<figure class="kg-card kg-image-card kg-width-wide">');
    expect(html).toContain('<img src="/content/media/a/b.png" alt="Alt text">');
    expect(html).toContain('<figcaption>A caption</figcaption>');
  });

  it('renders image card with numeric pixel dimensions from the media pipeline', () => {
    // The media pipeline records the asset's pixel width/height as numbers;
    // these must not break validation (they power intrinsic CLS attributes).
    const html = renderStudioDocumentToHtml(doc([
      card('image', { src: '/p.png', alt: 'p', width: 1200, height: 630 }),
    ]));
    expect(html).toContain('<img src="/p.png" alt="p" width="1200" height="630">');
    // numeric width must NOT produce a layout class
    expect(html).not.toContain('kg-width-1200');
  });

  it('renders gallery card', () => {
    const html = renderStudioDocumentToHtml(doc([
      card('gallery', { images: [
        { src: '/g1.png', alt: 'one' },
        { src: '/g2.png', alt: 'two' },
      ], caption: 'gal' }),
    ]));
    expect(html).toContain('kg-gallery-card');
    expect(html).toContain('/g1.png');
    expect(html).toContain('/g2.png');
    expect(html).toContain('<figcaption>gal</figcaption>');
  });

  it('renders video card with controls and poster', () => {
    const html = renderStudioDocumentToHtml(doc([
      card('video', { src: '/v.mp4', poster: '/poster.jpg', caption: 'vid' }),
    ]));
    expect(html).toContain('kg-video-card');
    expect(html).toContain('<video src="/v.mp4" controls');
    expect(html).toContain('poster="/poster.jpg"');
  });

  it('renders audio card', () => {
    const html = renderStudioDocumentToHtml(doc([
      card('audio', { src: '/a.mp3', title: 'Podcast' }),
    ]));
    expect(html).toContain('kg-audio-card');
    expect(html).toContain('<audio src="/a.mp3" controls');
    expect(html).toContain('Podcast');
  });

  it('renders file card as safe download link', () => {
    const html = renderStudioDocumentToHtml(doc([
      card('file', { src: '/f.pdf', fileName: 'report.pdf', fileSize: '1.2 MB' }),
    ]));
    expect(html).toContain('kg-file-card');
    expect(html).toContain('report.pdf');
    expect(html).toContain('download');
  });

  it('renders bookmark card with safe url', () => {
    const html = renderStudioDocumentToHtml(doc([
      card('bookmark', { url: 'https://example.com/a', title: 'Example', description: 'desc' }),
    ]));
    expect(html).toContain('kg-bookmark-card');
    expect(html).toContain('https://example.com/a');
    expect(html).toContain('Example');
  });

  it('renders embed card only for approved providers; others become safe links', () => {
    const yt = renderStudioDocumentToHtml(doc([
      card('embed', { url: 'https://www.youtube.com/watch?v=abc123', embedType: 'video' }),
    ]));
    expect(yt).toContain('kg-embed-card');
    expect(yt).toContain('<iframe src="https://www.youtube-nocookie.com/embed/abc123"');
    expect(yt).toContain('allowfullscreen');

    const evil = renderStudioDocumentToHtml(doc([
      card('embed', { url: 'https://evil.example/embed/x', embedType: 'video' }),
    ]));
    expect(evil).not.toContain('iframe');
    expect(evil).toContain('https://evil.example/embed/x');
  });

  it('renders button card as a link', () => {
    const html = renderStudioDocumentToHtml(doc([
      card('button', { text: 'Buy now', url: 'https://store.example/p' }),
    ]));
    expect(html).toContain('kg-button-card');
    expect(html).toContain('href="https://store.example/p"');
    expect(html).toContain('Buy now');
    expect(html).not.toContain('<button');
  });

  it('renders callout card', () => {
    const html = renderStudioDocumentToHtml(doc([
      card('callout', { text: 'Note this', emoji: '💡', backgroundColor: 'grey' }),
    ]));
    expect(html).toContain('kg-callout-card');
    expect(html).toContain('💡');
    expect(html).toContain('Note this');
  });

  it('renders toggle card as details/summary', () => {
    const html = renderStudioDocumentToHtml(doc([
      card('toggle', { heading: 'FAQ', content: 'Answer' }),
    ]));
    expect(html).toContain('<details class="kg-card kg-toggle-card">');
    expect(html).toContain('<summary>FAQ</summary>');
    expect(html).toContain('Answer');
  });

  it('renders markdown card', () => {
    const html = renderStudioDocumentToHtml(doc([
      card('markdown', { markdown: '**bold** and a [link](https://example.com)' }),
    ]));
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('https://example.com');
  });

  it('renders html card sanitized (script stripped, safe html kept)', () => {
    const html = renderStudioDocumentToHtml(doc([
      card('html', { html: '<div class="widget">Safe <strong>widget</strong></div><script>alert(1)</script><img src=x onerror=alert(2)>' }),
    ]));
    expect(html).toContain('<div class="widget">Safe <strong>widget</strong></div>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
  });

  it('renders divider card as <hr>', () => {
    const html = renderStudioDocumentToHtml(doc([card('divider', {})]));
    expect(html).toContain('<hr>');
  });

  it('skips cards with transient blob: media', () => {
    const html = renderStudioDocumentToHtml(doc([
      card('image', { src: 'blob:http://localhost:7777/abc', alt: 'x' }),
      { type: 'paragraph', children: [{ type: 'text', text: 'kept', format: 0, mode: 'normal', version: 1 }], version: 1 },
    ]));
    expect(html).not.toContain('blob:');
    expect(html).toContain('kept');
  });
});

describe('legacy react-studio-card content', () => {
  it('normalizes and renders legacy cards', () => {
    const html = renderStudioDocumentToHtml(doc([
      card('image', { src: '/legacy.png', alt: 'legacy' }, 'react-studio-card'),
      card('video', { src: '/legacy.mp4' }, 'react-studio-card'),
    ]));
    expect(html).toContain('kg-image-card');
    expect(html).toContain('/legacy.png');
    expect(html).toContain('kg-video-card');
    expect(html).toContain('/legacy.mp4');
  });

  it('renders legacy cards nested inside paragraphs without stray empty <p>', () => {
    const html = renderStudioDocumentToHtml(doc([
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: 'intro', format: 0, mode: 'normal', version: 1 },
          card('image', { src: '/n.png', alt: 'n' }, 'react-studio-card'),
        ],
        version: 1,
      },
    ]));
    expect(html).toContain('intro');
    expect(html).toContain('kg-image-card');
    expect((html.match(/<p><\/p>/g) || []).length).toBe(0);
  });
});

describe('unknown/corrupt cards — graceful failure', () => {
  it('skips unknown card types without crashing the article', () => {
    const html = renderStudioDocumentToHtml(doc([
      card('mystery-card', { x: 1 }),
      { type: 'paragraph', children: [{ type: 'text', text: 'rest of article', format: 0, mode: 'normal', version: 1 }], version: 1 },
    ]));
    expect(html).toContain('rest of article');
    // Unknown card must not leak internal data or break the article.
    expect(html).not.toContain('mystery-card');
  });

  it('skips cards with corrupt cardData', () => {
    const html = renderStudioDocumentToHtml(doc([
      card('image', { src: 12345 }),
      { type: 'paragraph', children: [{ type: 'text', text: 'survives', format: 0, mode: 'normal', version: 1 }], version: 1 },
    ]));
    expect(html).toContain('survives');
  });

  it('never leaks card payloads for unknown/corrupt/transient cards (HTML + plain text)', () => {
    const secret = 'secret-user-content';
    const internalUrl = 'https://private.example/internal';
    const assetSecret = 'asset-secret-id';
    const sensitive = [secret, internalUrl, assetSecret];

    const input = doc([
      { type: 'studio-card', cardType: 'mystery-type', cardData: { secret, url: internalUrl, assetId: assetSecret, nested: { inner: secret } }, version: 1 },
      { type: 'studio-card', cardType: 'image', cardData: { secret, src: 12345, assetId: assetSecret, url: internalUrl }, version: 1 },
      { type: 'studio-card', cardType: 'video', cardData: { src: 'blob:http://localhost/xyz', secret }, version: 1 },
      { type: 'paragraph', children: [{ type: 'text', text: 'rest of article', format: 0, mode: 'normal', version: 1 }], version: 1 },
    ]);

    const html = renderStudioDocumentToHtml(input);
    expect(html).toContain('rest of article');
    for (const value of sensitive) {
      expect(html, `HTML must not leak ${value}`).not.toContain(value);
    }
    // No internal diagnostic comments reach the public HTML (sanitizer strips them).
    expect(html).not.toContain('<!--');

    const text = renderStudioDocumentToPlainText(input);
    expect(text).toContain('rest of article');
    for (const value of sensitive) {
      expect(text, `plain text must not leak ${value}`).not.toContain(value);
    }
    expect(text).not.toContain('blob:');
  });

  it('renders interactive tables with proper containers and headers', () => {
    const tableDoc = doc([
      {
        type: 'table',
        children: [
          {
            type: 'tablerow',
            children: [
              { type: 'tablecell', headerState: 1, children: [{ type: 'text', text: 'Column 1', format: 1 }] },
              { type: 'tablecell', headerState: 1, children: [{ type: 'text', text: 'Column 2', format: 1 }] },
            ],
          },
          {
            type: 'tablerow',
            children: [
              { type: 'tablecell', children: [{ type: 'text', text: 'Data 1', format: 0 }] },
              { type: 'tablecell', children: [{ type: 'text', text: 'Data 2', format: 0 }] },
            ],
          },
        ],
      },
    ]);
    const html = renderStudioDocumentToHtml(tableDoc);
    expect(html).toContain('studio-table-container');
    expect(html).toContain('<table class="studio-table">');
    expect(html).toContain('<th><strong>Column 1</strong></th>');
    expect(html).toContain('<td>Data 1</td>');
  });

  it('renders checklists with disabled checkboxes and state classes', () => {
    const checklistDoc = doc([
      {
        type: 'list',
        listType: 'check',
        children: [
          { type: 'listitem', checked: true, children: [{ type: 'text', text: 'Done task', format: 0 }] },
          { type: 'listitem', checked: false, children: [{ type: 'text', text: 'Pending task', format: 0 }] },
        ],
      },
    ]);
    const html = renderStudioDocumentToHtml(checklistDoc);
    expect(html).toContain('studio-checklist');
    expect(html).toContain('studio-checklist-item is-checked');
    expect(html).toContain('checked="checked"');
    expect(html).toContain('Done task');
    expect(html).toContain('Pending task');
  });

  it('renders nothing for empty documents', () => {
    expect(renderStudioDocumentToHtml({ root: { type: 'root', children: [] } })).toBe('');
  });
});

describe('security — XSS_TEST_PAYLOADS through the html card', () => {
  it('neutralizes every XSS payload while preserving safe content', () => {
    const payloads = XSS_TEST_PAYLOADS.join(' ');
    const html = renderStudioDocumentToHtml(doc([card('html', { html: payloads })]));
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('srcdoc');
  });
});

describe('renderStudioDocumentToPlainText', () => {
  it('includes card plain text and never leaks raw html', () => {
    const text = renderStudioDocumentToPlainText(doc([
      { type: 'paragraph', children: [{ type: 'text', text: 'Intro', format: 0, mode: 'normal', version: 1 }], version: 1 },
      card('image', { src: '/x.png', alt: '', caption: 'The cap' }),
      card('html', { html: '<p>Raw <strong>html</strong> text</p>' }),
      card('button', { text: 'CTA', url: 'https://x.com' }),
      card('divider', {}),
    ]));
    expect(text).toContain('Intro');
    expect(text).toContain('The cap');
    expect(text).toContain('Raw html text');
    expect(text).toContain('CTA');
    expect(text).toContain('---');
    expect(text).not.toContain('<strong>');
    expect(text).not.toContain('<p>');
  });
});
