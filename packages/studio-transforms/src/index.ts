import { LexicalEditor } from 'lexical';
import { QuoteNode, $isQuoteNode } from '@lexical/rich-text';
import { ListNode, $isListNode, $isListItemNode } from '@lexical/list';

export function registerStudioTransforms(editor: LexicalEditor): () => void {
  const unregisterQuote = editor.registerNodeTransform(QuoteNode, (node: QuoteNode) => {
    // Prevent nested quotes
    const parent = node.getParent();
    if ($isQuoteNode(parent)) {
      const children = node.getChildren();
      for (const child of children) {
        parent.insertBefore(child);
      }
      node.remove();
    }
  });

  const unregisterList = editor.registerNodeTransform(ListNode, (node: ListNode) => {
    // Ensure list items are contained within list node
    const children = node.getChildren();
    for (const child of children) {
      if (!$isListItemNode(child)) {
        // Wrap orphaned node in list item if needed
      }
    }
  });

  return () => {
    unregisterQuote();
    unregisterList();
  };
}
