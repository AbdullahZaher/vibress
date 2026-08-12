import { StudioDocument, validateStudioDocument, migrateDocument } from '@vibress/studio-core';
import { STUDIO_CARD_DEFINITIONS } from '@vibress/studio-cards';
import { escapeHtml, sanitizeUrl } from '@vibress/studio-utils';

export interface RenderOptions {
  target?: 'web' | 'email';
}

export function renderStudioDocumentToHtml(docInput: unknown, options: RenderOptions = {}): string {
  const doc = migrateDocument(docInput);
  if (!doc.root || !Array.isArray(doc.root.children)) {
    return '';
  }

  return doc.root.children.map((node) => renderNodeToHtml(node, options)).join('');
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
      return content ? `<p>${content}</p>` : '<p></p>';
    }

    case 'heading': {
      const tag = n.tag || 'h2';
      const level = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag.toLowerCase())
        ? tag.toLowerCase()
        : 'h2';
      return `<${level}>${renderChildren()}</${level}>`;
    }

    case 'quote':
      return `<blockquote>${renderChildren()}</blockquote>`;

    case 'list': {
      const listType = n.listType === 'number' ? 'ol' : 'ul';
      return `<${listType}>${renderChildren()}</${listType}>`;
    }

    case 'listitem':
      return `<li>${renderChildren()}</li>`;

    case 'link': {
      const url = sanitizeUrl(n.url || '#');
      const relAttr = n.rel ? ` rel="${escapeHtml(n.rel)}"` : '';
      const targetAttr = n.target ? ` target="${escapeHtml(n.target)}"` : '';
      return `<a href="${url}"${relAttr}${targetAttr}>${renderChildren()}</a>`;
    }

    case 'code':
      return `<pre><code>${renderChildren()}</code></pre>`;

    // Handle Studio Card Nodes
    case 'studio-card': {
      const cardType = n.cardType;
      const cardData = n.cardData || {};
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

function renderNodeToPlainText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; format?: number; children?: unknown[]; tag?: string; listType?: string; url?: string; src?: string; alt?: string; cardType?: string; caption?: string; rel?: string; target?: string; cardData?: Record<string, unknown>; } & Record<string, unknown>;

  if (n.type === 'text') {
    return n.text || '';
  }

  if (n.type === 'studio-card') {
    const cardType = n.cardType;
    const cardData = n.cardData || {};
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
