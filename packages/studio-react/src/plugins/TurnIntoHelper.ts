import {
  $getSelection,
  $isRangeSelection,
  $getNodeByKey,
  $createParagraphNode,
  LexicalEditor,
} from "lexical";
import {
  $createHeadingNode,
  $createQuoteNode,
  HeadingTagType,
} from "@lexical/rich-text";
import { $createListNode } from "@lexical/list";
import { $createCodeNode } from "@lexical/code";
import { $setBlocksType } from "@lexical/selection";

export type TurnIntoType =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "bullet-list"
  | "number-list"
  | "check-list"
  | "quote"
  | "code";

function applyBlockType(type: TurnIntoType) {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return;
  }

  switch (type) {
    case "paragraph": {
      $setBlocksType(selection, () => $createParagraphNode());
      break;
    }
    case "h1":
    case "h2":
    case "h3": {
      const tag = type as HeadingTagType;
      $setBlocksType(selection, () => $createHeadingNode(tag));
      break;
    }
    case "quote": {
      $setBlocksType(selection, () => $createQuoteNode());
      break;
    }
    case "code": {
      $setBlocksType(selection, () => $createCodeNode());
      break;
    }
    case "bullet-list": {
      $setBlocksType(selection, () => $createListNode("bullet"));
      break;
    }
    case "number-list": {
      $setBlocksType(selection, () => $createListNode("number"));
      break;
    }
    case "check-list": {
      $setBlocksType(selection, () => $createListNode("check"));
      break;
    }
  }
}

export function turnSelectedBlockInto(
  editor: LexicalEditor,
  type: TurnIntoType,
): void {
  editor.update(
    () => {
      applyBlockType(type);
    },
    { discrete: true },
  );
}

export function turnNodeInto(
  editor: LexicalEditor,
  nodeKey: string,
  type: TurnIntoType,
): void {
  editor.update(
    () => {
      const node = $getNodeByKey(nodeKey);
      if (!node) return;
      if (
        "select" in node &&
        typeof (node as { select?: () => void }).select === "function"
      ) {
        (node as { select: () => void }).select();
      }
      applyBlockType(type);
    },
    { discrete: true },
  );
}

