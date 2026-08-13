import { StudioDocument, validateStudioDocument, migrateDocument } from '@vibress/studio-core';
import { STUDIO_CARD_DEFINITIONS } from '@vibress/studio-cards';
import { escapeHtml, sanitizeUrl, sanitizeStudioHtml } from '@vibress/studio-utils';

export interface RenderOptions {
  target?: 'web' | 'email';
}

export function renderStudioDocumentToHtml(docInput: unknown, options: RenderOptions = {}): string {
  // migrateDocument applies the canonical normalization layer
  // (react-studio-card → studio-card) plus legacy migration.
  const doc = migrateDocument(docInput);
  if (!doc.root || !Array.isArray(doc.root.children)) {
    return '';
  }

  const raw = doc.root.children.map((node) => renderNodeToHtml(node, options)).join('');

  // FINAL security boundary: every Studio card's rendered markup passes
  // through the shared allowlist sanitizer before leaving the server.
  // CSP remains a second, independent defense layer.
  return sanitizeStudioHtml(raw);
}

function renderNodeToHtml(node: unknown, options: RenderOptions): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; format?: number; children?: unknown[]; tag?: string; listType?: string; url?: string; src?: string; alt?: string; cardType?: string; caption?: string; rel?: string; target?: string; cardData?: Record<string, unknown>; } & Record<string, unknown>;

  const type = n.type;

  // Handle TextNode
  if (type === 'text') {
    let text = escapeHtml(n.text || '');
    const format = typeof n.format === 'number' ? n.format : 0;

    // Lexical format bitmask: 1=Bold, 2=Italic, 4=Strikethrough, 8=Underline, 16=Code, 32=Subscript, 64=Superscript
    if (format & 16) text = `<code>${text}</code>`;
    if (format & 1) text = `<strong>${text}</strong>`;
    if (format & 2) text = `<em>${text}</em>`;
    if (format & 4) text = `<s>${text}</s>`;
    if (format & 8) text = `<u>${text}</u>`;

    return text;
  }

  // Render children helper
  const renderChildren = () => {
    if (Array.isArray(n.children)) {
      return n.children.map((child: unknown) => renderNodeToHtml(child, options)).join('');
    }
    return '';
  };

  // Handle Element Nodes
  switch (type) {
    case 'paragraph': {
      const content = renderChildren();
      // Block-level cards must never be wrapped in <p> (invalid HTML that
      // the final sanitizer would split, leaving stray empty <p> nodes).
      const hasBlockCard = Array.isArray(n.children) && n.children.some(
        (child: unknown) =>
          child && typeof child === 'object' &&
          ((child as { type?: string }).type === 'studio-card')
      );
      if (hasBlockCard) return content;
      const styleAttr = n.style ? ` style="${escapeHtml(String(n.style))}"` : '';
      return content ? `<p${styleAttr}>${content}</p>` : '<p></p>';
    }

    case 'heading': {
      const tag = n.tag || 'h2';
      const level = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag.toLowerCase())
        ? tag.toLowerCase()
        : 'h2';
      const styleAttr = n.style ? ` style="${escapeHtml(String(n.style))}"` : '';
      return `<${level}${styleAttr}>${renderChildren()}</${level}>`;
    }

    case 'quote':
      return `<blockquote>${renderChildren()}</blockquote>`;

    case 'list': {
      if (n.listType === 'check') {
        return `<ul class="studio-checklist">${renderChildren()}</ul>`;
      }
      const listType = n.listType === 'number' ? 'ol' : 'ul';
      return `<${listType}>${renderChildren()}</${listType}>`;
    }

    case 'listitem': {
      if (typeof n.checked === 'boolean') {
        const isChecked = n.checked;
        const checkedAttr = isChecked ? ' checked="checked"' : '';
        const checkedClass = isChecked ? ' is-checked' : '';
        return `<li class="studio-checklist-item${checkedClass}"><input type="checkbox"${checkedAttr} disabled /><span>${renderChildren()}</span></li>`;
      }
      return `<li>${renderChildren()}</li>`;
    }

    case 'table':
      return `<div class="studio-table-container"><table class="studio-table"><tbody>${renderChildren()}</tbody></table></div>`;

    case 'tablerow':
      return `<tr>${renderChildren()}</tr>`;

    case 'tablecell': {
      const isHeader = n.headerState && n.headerState !== 0;
      const tag = isHeader ? 'th' : 'td';
      const colSpan = n.colSpan && Number(n.colSpan) > 1 ? ` colspan="${n.colSpan}"` : '';
      const rowSpan = n.rowSpan && Number(n.rowSpan) > 1 ? ` rowspan="${n.rowSpan}"` : '';
      const bg = n.backgroundColor ? ` style="background-color: ${escapeHtml(String(n.backgroundColor))}"` : '';
      return `<${tag}${colSpan}${rowSpan}${bg}>${renderChildren()}</${tag}>`;
    }

    case 'link': {
      const url = sanitizeUrl(n.url || '#');
      const relAttr = n.rel ? ` rel="${escapeHtml(n.rel)}"` : '';
      const targetAttr = n.target ? ` target="${escapeHtml(n.target)}"` : '';
      return `<a href="${url}"${relAttr}${targetAttr}>${renderChildren()}</a>`;
    }

    case 'code':
      return `<pre><code>${renderChildren()}</code></pre>`;

    // Handle Studio Card Nodes (canonical type after normalization)
    case 'studio-card': {
      const cardType = n.cardType;
      const cardData = n.cardData || {};
      // A blob: URL only exists for the current browser session and can never
      // be published; skip the card rather than emit a broken/leaky reference.
      if (hasTransientMedia(cardData)) {
        return `<!-- Card skipped: ${escapeHtml(cardType || 'card')} (transient media) -->`;
      }
      const def = cardType ? STUDIO_CARD_DEFINITIONS[cardType] : undefined;
      if (def) {
        try {
          const validated = def.validate(cardData);
          return def.renderHtml(validated);
        } catch {
          return `<!-- Error rendering card: ${escapeHtml(cardType || '')} -->`;
        }
      }
      return `<!-- Unknown card: ${escapeHtml(cardType || '')} -->`;
    }

    default:
      // Unknown element node fallback: render children if available
      return renderChildren();
  }
}

export function renderStudioDocumentToPlainText(docInput: unknown): string {
  const doc = migrateDocument(docInput);
  if (!doc.root || !Array.isArray(doc.root.children)) {
    return '';
  }

  return doc.root.children
    .map((node) => renderNodeToPlainText(node))
    .filter(Boolean)
    .join('\n\n');
}

function hasTransientMedia(cardData: Record<string, unknown>): boolean {
  const candidates: Array<unknown> = [cardData.src, cardData.poster, cardData.thumbnail];
  if (Array.isArray(cardData.images)) {
    for (const img of cardData.images) {
      if (img && typeof img === 'object') {
        candidates.push((img as Record<string, unknown>).src);
      }
    }
  }
  return candidates.some((v) => typeof v === 'string' && (v as string).toLowerCase().startsWith('blob:'));
}

function renderNodeToPlainText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; format?: number; children?: unknown[]; tag?: string; listType?: string; url?: string; src?: string; alt?: string; cardType?: string; caption?: string; rel?: string; target?: string; cardData?: Record<string, unknown>; } & Record<string, unknown>;

  if (n.type === 'text') {
    return n.text || '';
  }

  if (n.type === 'studio-card') {
    const cardType = n.cardType;
    const cardData = n.cardData || {};
    // Transient blob: media must never surface in excerpts/search text.
    if (hasTransientMedia(cardData)) {
      return '';
    }
    const def = cardType ? STUDIO_CARD_DEFINITIONS[cardType] : undefined;
    if (def) {
      try {
        const validated = def.validate(cardData);
        return def.renderPlainText(validated);
      } catch {
        return '';
      }
    }
    return '';
  }

  if (Array.isArray(n.children)) {
    return n.children.map((child: unknown) => renderNodeToPlainText(child)).join('');
  }

  return '';
}
