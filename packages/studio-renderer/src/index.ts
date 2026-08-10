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

function renderNodeToHtml(node: any, options: RenderOptions): string {
  if (!node || typeof node !== 'object') return '';

  const type = node.type;

  // Handle TextNode
  if (type === 'text') {
    let text = escapeHtml(node.text || '');
    const format = typeof node.format === 'number' ? node.format : 0;

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
    if (Array.isArray(node.children)) {
      return node.children.map((child: any) => renderNodeToHtml(child, options)).join('');
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
      const tag = node.tag || 'h2';
      const level = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag.toLowerCase())
        ? tag.toLowerCase()
        : 'h2';
      return `<${level}>${renderChildren()}</${level}>`;
    }

    case 'quote':
      return `<blockquote>${renderChildren()}</blockquote>`;

    case 'list': {
      const listType = node.listType === 'number' ? 'ol' : 'ul';
      return `<${listType}>${renderChildren()}</${listType}>`;
    }

    case 'listitem':
      return `<li>${renderChildren()}</li>`;

    case 'link': {
      const url = sanitizeUrl(node.url || '#');
      const relAttr = node.rel ? ` rel="${escapeHtml(node.rel)}"` : '';
      const targetAttr = node.target ? ` target="${escapeHtml(node.target)}"` : '';
      return `<a href="${url}"${relAttr}${targetAttr}>${renderChildren()}</a>`;
    }

    case 'code':
      return `<pre><code>${renderChildren()}</code></pre>`;

    // Handle Studio Card Nodes
    case 'studio-card': {
      const cardType = node.cardType;
      const cardData = node.cardData || {};
      const def = STUDIO_CARD_DEFINITIONS[cardType];
      if (def) {
        try {
          const validated = def.validate(cardData);
          return def.renderHtml(validated);
        } catch {
          return `<!-- Error rendering card: ${escapeHtml(cardType)} -->`;
        }
      }
      return `<!-- Unknown card: ${escapeHtml(cardType)} -->`;
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

function renderNodeToPlainText(node: any): string {
  if (!node || typeof node !== 'object') return '';

  if (node.type === 'text') {
    return node.text || '';
  }

  if (node.type === 'studio-card') {
    const cardType = node.cardType;
    const cardData = node.cardData || {};
    const def = STUDIO_CARD_DEFINITIONS[cardType];
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

  if (Array.isArray(node.children)) {
    return node.children.map((child: any) => renderNodeToPlainText(child)).join('');
  }

  return '';
}
