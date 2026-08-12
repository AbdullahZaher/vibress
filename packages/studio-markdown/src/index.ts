import { StudioDocument, migrateDocument } from '@vibress/studio-core';
import { renderStudioDocumentToPlainText } from '@vibress/studio-renderer';
import { parseMarkdownToHtml } from '@vibress/studio-utils';

export { parseMarkdownToHtml };

export function studioDocumentToMarkdown(docInput: unknown): string {
  const doc = migrateDocument(docInput);
  if (!doc.root || !Array.isArray(doc.root.children)) {
    return '';
  }

  return doc.root.children
    .map((node: unknown) => renderNodeToMarkdown(node))
    .filter(Boolean)
    .join('\n\n');
}

function renderNodeToMarkdown(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; format?: number; children?: unknown[]; tag?: string; listType?: string; url?: string; src?: string; alt?: string; cardType?: string; caption?: string; cardData?: Record<string, unknown>; } & Record<string, unknown>;

  const type = n.type;

  if (type === 'text') {
    let text = n.text || '';
    const format = typeof n.format === 'number' ? n.format : 0;
    if (format & 16) text = `\`${text}\``;
    if (format & 1) text = `**${text}**`;
    if (format & 2) text = `*${text}*`;
    if (format & 4) text = `~~${text}~~`;
    return text;
  }

  const renderChildren = () => {
    if (Array.isArray(n.children)) {
      return n.children.map((child: unknown) => renderNodeToMarkdown(child)).join('');
    }
    return '';
  };

  switch (type) {
    case 'paragraph':
      return renderChildren();

    case 'heading': {
      const tag = (n.tag || 'h2').toLowerCase();
      const hashes = tag === 'h1' ? '#' : tag === 'h2' ? '##' : tag === 'h3' ? '###' : '####';
      return `${hashes} ${renderChildren()}`;
    }

    case 'quote':
      return `> ${renderChildren()}`;

    case 'list':
      return renderChildren();

    case 'listitem':
      return `- ${renderChildren()}`;

    case 'link':
      return `[${renderChildren()}](${n.url || '#'})`;

    case 'code':
      return `\`\`\`\n${renderChildren()}\n\`\`\``;

    case 'studio-card': {
      if (n.cardType === 'divider') return '---';
      if (n.cardType === 'markdown') return (n.cardData?.markdown as string | undefined) || '';
      return `[Card: ${n.cardType}]`;
    }

    default:
      return renderChildren();
  }
}
