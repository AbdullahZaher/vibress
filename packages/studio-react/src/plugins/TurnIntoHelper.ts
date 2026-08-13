import {
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  LexicalEditor,
} from 'lexical';
import {
  $createHeadingNode,
  $createQuoteNode,
  HeadingTagType,
} from '@lexical/rich-text';
import {
  $createListNode,
} from '@lexical/list';
import { $createCodeNode } from '@lexical/code';
import { $setBlocksType } from '@lexical/selection';

export type TurnIntoType =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet-list'
  | 'number-list'
  | 'check-list'
  | 'quote'
  | 'code';

export function turnSelectedBlockInto(
  editor: LexicalEditor,
  type: TurnIntoType
): void {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      return;
    }

    switch (type) {
      case 'paragraph': {
        $setBlocksType(selection, () => $createParagraphNode());
        break;
      }
      case 'h1':
      case 'h2':
      case 'h3': {
        const tag = type as HeadingTagType;
        $setBlocksType(selection, () => $createHeadingNode(tag));
        break;
      }
      case 'quote': {
        $setBlocksType(selection, () => $createQuoteNode());
        break;
      }
      case 'code': {
        $setBlocksType(selection, () => $createCodeNode());
        break;
      }
      case 'bullet-list': {
        $setBlocksType(selection, () => $createListNode('bullet'));
        break;
      }
      case 'number-list': {
        $setBlocksType(selection, () => $createListNode('number'));
        break;
      }
      case 'check-list': {
        $setBlocksType(selection, () => $createListNode('check'));
        break;
      }
    }
  });
}
