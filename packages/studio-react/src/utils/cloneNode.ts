import {
  $isElementNode,
  $parseSerializedNode,
  LexicalNode,
} from 'lexical';
import { StudioCardNode } from '@vibress/studio-cards';
import { ReactStudioCardNode } from '../nodes/ReactStudioCardNode';

/**
 * Deep clones any Lexical node (paragraphs, headings, blockquotes, lists, tables, cards, etc.)
 * including nested children and serialized properties, so duplication preserves all content and structure.
 */
export function $deepCloneNode(node: LexicalNode): LexicalNode {
  if (node instanceof StudioCardNode) {
    return new ReactStudioCardNode(
      node.getCardType(),
      JSON.parse(JSON.stringify(node.getCardData()))
    );
  }

  const json = node.exportJSON();
  const clone = $parseSerializedNode(json);

  if ($isElementNode(node) && $isElementNode(clone)) {
    for (const child of node.getChildren()) {
      clone.append($deepCloneNode(child));
    }
  }

  return clone;
}
