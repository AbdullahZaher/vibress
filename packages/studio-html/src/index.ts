import { StudioDocument, createEmptyStudioDocument, createDefaultStudioDocument } from '@vibress/studio-core';
import { sanitizeHtml } from '@vibress/studio-utils';

export function htmlToStudioDocument(htmlInput: string): StudioDocument {
  if (!htmlInput || typeof htmlInput !== 'string') {
    return createEmptyStudioDocument();
  }

  const cleanHtml = sanitizeHtml(htmlInput.trim());
  if (!cleanHtml) {
    return createEmptyStudioDocument();
  }

  // Parse HTML tags into simple Lexical paragraph / heading structure
  const paragraphRegex = /<(p|h1|h2|h3|h4|h5|h6|blockquote|li|pre)[^>]*>(.*?)<\/\1>/gi;
  const children: unknown[] = [];
  let match: RegExpExecArray | null;

  while ((match = paragraphRegex.exec(cleanHtml)) !== null) {
    const fullMatch = match[0];
    const tagMatch = match[1];
    const textMatch = match[2];

    if (!tagMatch || textMatch === undefined) continue;

    const tag = tagMatch.toLowerCase();
    const rawText = textMatch.replace(/<[^>]+>/g, '').trim();

    if (tag.startsWith('h')) {
      children.push({
        type: 'heading',
        tag: tag,
        children: [{ type: 'text', text: rawText, format: 0, mode: 'normal', version: 1 }],
        direction: null,
        format: '',
        indent: 0,
        version: 1,
      });
    } else if (tag === 'blockquote') {
      children.push({
        type: 'quote',
        children: [{ type: 'text', text: rawText, format: 0, mode: 'normal', version: 1 }],
        direction: null,
        format: '',
        indent: 0,
        version: 1,
      });
    } else {
      children.push({
        type: 'paragraph',
        children: [{ type: 'text', text: rawText, format: 0, mode: 'normal', version: 1 }],
        direction: null,
        format: '',
        indent: 0,
        version: 1,
      });
    }
  }

  if (children.length === 0) {
    // Strip tags and create default
    const plainText = cleanHtml.replace(/<[^>]+>/g, '').trim();
    return createDefaultStudioDocument(plainText);
  }

  return {
    schema: 'vibress-studio',
    version: 1,
    editor: { lexicalVersion: '0.13.1' },
    root: {
      type: 'root',
      children: children,
      direction: null,
      format: '',
      indent: 0,
      version: 1,
    },
  };
}
