import React, { useCallback, useMemo, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import {
  $getSelection,
  $getNodeByKey,
  $getRoot,
  $isRangeSelection,
  TextNode,
  $createParagraphNode,
} from "lexical";
import { logForensicEvent, extractDocStats, hashString } from "@vibress/studio-utils";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $createListNode } from "@lexical/list";
import { $createCodeNode } from "@lexical/code";
import { $createTableNodeWithDimensions } from "@lexical/table";
import {
  $createReactStudioCardNode,
  $isReactStudioCardNode,
} from "../nodes/ReactStudioCardNode";
import { StudioCardNode } from "@vibress/studio-cards";
import { createPortal } from "react-dom";
import {
  ImageIcon,
  Video,
  Images,
  File as FileIcon,
  Code,
  Minus,
  MessageSquare,
  Box,
  MousePointerClick,
  Table as TableIcon,
  CheckSquare,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Sparkles,
  Bookmark,
  ChevronRight,
  Code2,
  Layers,
} from "lucide-react";

export class StudioMenuOption extends MenuOption {
  title: string;
  category: "basic" | "card" | "ai";
  cardType?: string | undefined;
  actionType?: string | undefined;
  icon: React.ReactNode;
  description: string;

  constructor(
    title: string,
    category: "basic" | "card" | "ai",
    icon: React.ReactNode,
    description: string,
    extra?: { cardType?: string; actionType?: string },
  ) {
    super(title);
    this.title = title;
    this.category = category;
    this.icon = icon;
    this.description = description;
    this.cardType = extra?.cardType;
    this.actionType = extra?.actionType;
  }
}

export function SlashMenuPlugin({
  requestMedia,
}: {
  requestMedia?:
    | ((req: { cardType: string }) => Promise<Record<string, unknown> | null>)
    | undefined;
}) {
  const [editor] = useLexicalComposerContext();
  const [queryString, setQueryString] = useState<string | null>(null);

  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch("/", {
    minLength: 0,
  });

  const baseOptions: StudioMenuOption[] = useMemo(() => {
    const list: StudioMenuOption[] = [
      // AI
      new StudioMenuOption(
        "Ask AI",
        "ai",
        <Sparkles size={16} color="#a855f7" />,
        "Write, summarize, or brainstorm with AI",
        { actionType: "ai" },
      ),

      // Basic Blocks
      new StudioMenuOption(
        "Text",
        "basic",
        <Box size={16} />,
        "Just start writing with plain text",
        { actionType: "paragraph" },
      ),
      new StudioMenuOption(
        "Heading 1",
        "basic",
        <Heading1 size={16} />,
        "Large section heading",
        { actionType: "h1" },
      ),
      new StudioMenuOption(
        "Heading 2",
        "basic",
        <Heading2 size={16} />,
        "Medium section heading",
        { actionType: "h2" },
      ),
      new StudioMenuOption(
        "Heading 3",
        "basic",
        <Heading3 size={16} />,
        "Small section heading",
        { actionType: "h3" },
      ),
      new StudioMenuOption(
        "To-do list",
        "basic",
        <CheckSquare size={16} color="#10b981" />,
        "Track tasks with a to-do checklist",
        { actionType: "check-list" },
      ),
      new StudioMenuOption(
        "Table",
        "basic",
        <TableIcon size={16} color="#3b82f6" />,
        "Add a flexible 3x3 table grid",
        { actionType: "table" },
      ),
      new StudioMenuOption(
        "Bulleted list",
        "basic",
        <List size={16} />,
        "Create a simple bulleted list",
        { actionType: "bullet-list" },
      ),
      new StudioMenuOption(
        "Numbered list",
        "basic",
        <ListOrdered size={16} />,
        "Create a numbered list",
        { actionType: "number-list" },
      ),
      new StudioMenuOption(
        "Quote",
        "basic",
        <Quote size={16} />,
        "Capture a quotation or callout quote",
        { actionType: "quote" },
      ),
      new StudioMenuOption(
        "Code Block",
        "basic",
        <Code size={16} />,
        "Capture a code snippet with syntax highlighting",
        { actionType: "code" },
      ),
      new StudioMenuOption(
        "Divider",
        "basic",
        <Minus size={16} />,
        "Visually divide blocks with a line",
        { cardType: "divider" },
      ),

      // Media & Rich Cards
      new StudioMenuOption(
        "Image",
        "card",
        <ImageIcon size={16} color="#0284c7" />,
        "Upload or embed with image card",
        { cardType: "image" },
      ),
      new StudioMenuOption(
        "Gallery",
        "card",
        <Images size={16} color="#0284c7" />,
        "Create an image grid or gallery",
        { cardType: "gallery" },
      ),
      new StudioMenuOption(
        "Video",
        "card",
        <Video size={16} color="#dc2626" />,
        "Embed or upload a video clip",
        { cardType: "video" },
      ),
      new StudioMenuOption(
        "Audio",
        "card",
        <Box size={16} color="#ea580c" />,
        "Upload an audio file or podcast track",
        { cardType: "audio" },
      ),
      new StudioMenuOption(
        "File",
        "card",
        <FileIcon size={16} color="#d97706" />,
        "Upload a downloadable document or asset",
        { cardType: "file" },
      ),
      new StudioMenuOption(
        "Bookmark",
        "card",
        <Bookmark size={16} color="#4f46e5" />,
        "Embed a web link with rich preview card",
        { cardType: "bookmark" },
      ),
      new StudioMenuOption(
        "Embed",
        "card",
        <Layers size={16} color="#7c3aed" />,
        "Embed YouTube, Vimeo, Spotify, or Twitter",
        { cardType: "embed" },
      ),
      new StudioMenuOption(
        "Callout",
        "card",
        <MessageSquare size={16} color="#16a34a" />,
        "Make writing stand out with an alert box",
        { cardType: "callout" },
      ),
      new StudioMenuOption(
        "Toggle",
        "card",
        <ChevronRight size={16} color="#64748b" />,
        "Hide or show collapsible text",
        { cardType: "toggle" },
      ),
      new StudioMenuOption(
        "Button",
        "card",
        <MousePointerClick size={16} color="#2563eb" />,
        "Add a clickable call-to-action button",
        { cardType: "button" },
      ),
      new StudioMenuOption(
        "Markdown",
        "card",
        <Code2 size={16} color="#475569" />,
        "Insert raw markdown block",
        { cardType: "markdown" },
      ),
      new StudioMenuOption(
        "HTML",
        "card",
        <Code size={16} color="#e11d48" />,
        "Insert raw custom HTML",
        { cardType: "html" },
      ),
    ];
    return list;
  }, []);

  const options = useMemo(() => {
    if (!queryString) return baseOptions;
    const regex = new RegExp(queryString, "i");
    return baseOptions.filter(
      (opt) =>
        regex.test(opt.title) ||
        (opt.cardType && regex.test(opt.cardType)) ||
        (opt.actionType && regex.test(opt.actionType)),
    );
  }, [baseOptions, queryString]);

  const onSelectOption = useCallback(
    (
      selectedOption: StudioMenuOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void,
      matchingString?: string,
    ) => {
      let insertedKey: string | null = null;
      const cardType = selectedOption.cardType;
      const actionType = selectedOption.actionType;

      const beforeDoc = editor.getEditorState().toJSON();
      const beforeStats = extractDocStats(beforeDoc);
      logForensicEvent("BEFORE_SLASH_COMMAND", {
        cardType,
        actionType,
        childCount: beforeStats.childCount,
        wordCount: beforeStats.wordCount,
        hash: beforeStats.hash,
        hasNodeToRemove: !!nodeToRemove,
        nodeToRemoveText: nodeToRemove?.getTextContent(),
      });

      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || selectedOption == null) {
          return;
        }

        if (nodeToRemove) {
          const query = matchingString ?? queryString ?? "";
          const textContent = nodeToRemove.getTextContent();
          const triggerQuery = "/" + query;

          // 1. Authoritative check: If nodeToRemove was already split by Lexical,
          // it contains only the trigger + query.
          if (
            textContent === triggerQuery ||
            textContent === "/" ||
            textContent.trim() === triggerQuery
          ) {
            nodeToRemove.remove();
          } else {
            // 2. Authoritative selection check: if caret is inside nodeToRemove
            let triggerStart = -1;
            let triggerLen = triggerQuery.length;

            if (selection.isCollapsed()) {
              const anchor = selection.anchor;
              if (anchor.getNode().getKey() === nodeToRemove.getKey()) {
                const caret = anchor.offset;
                if (
                  caret >= triggerLen &&
                  textContent.slice(caret - triggerLen, caret) === triggerQuery
                ) {
                  triggerStart = caret - triggerLen;
                }
              }
            }

            // 3. Fallback: match Lexical typeahead trigger pattern (^|\s|\()(/query)
            if (triggerStart === -1) {
              const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const regex = new RegExp("(^|\\s|\\()(\\/" + escapedQuery + ")", "g");
              let match: RegExpExecArray | null;
              let lastMatchIdx = -1;
              while ((match = regex.exec(textContent)) !== null) {
                lastMatchIdx = match.index + (match[1]?.length ?? 0);
              }
              if (lastMatchIdx !== -1) {
                triggerStart = lastMatchIdx;
              } else {
                triggerStart = textContent.lastIndexOf("/");
                triggerLen = query.length + 1;
              }
            }

            if (triggerStart !== -1) {
              const prefix = textContent.slice(0, triggerStart);
              const suffix = textContent.slice(triggerStart + triggerLen);
              const newText = prefix + suffix;
              if (newText.length > 0) {
                nodeToRemove.setTextContent(newText);
                nodeToRemove.select(prefix.length, prefix.length);
              } else {
                nodeToRemove.remove();
              }
            } else {
              nodeToRemove.remove();
            }
          }
        }

        if (actionType) {
          switch (actionType) {
            case "paragraph": {
              const p = $createParagraphNode();
              selection.insertNodes([p]);
              break;
            }
            case "h1":
            case "h2":
            case "h3": {
              const h = $createHeadingNode(actionType);
              selection.insertNodes([h]);
              break;
            }
            case "check-list": {
              const list = $createListNode("check");
              selection.insertNodes([list]);
              break;
            }
            case "table": {
              const table = $createTableNodeWithDimensions(3, 3, true);
              selection.insertNodes([table]);
              break;
            }
            case "bullet-list": {
              const list = $createListNode("bullet");
              selection.insertNodes([list]);
              break;
            }
            case "number-list": {
              const list = $createListNode("number");
              selection.insertNodes([list]);
              break;
            }
            case "quote": {
              const q = $createQuoteNode();
              selection.insertNodes([q]);
              break;
            }
            case "code": {
              const c = $createCodeNode();
              selection.insertNodes([c]);
              break;
            }
          }
        } else if (cardType) {
          const cardNode = $createReactStudioCardNode(cardType, {});
          selection.insertNodes([cardNode]);
          insertedKey = cardNode.getKey();
        }

        logForensicEvent("AFTER_CARD_INSERT", {
          cardType,
          insertedKey,
          childCount: $getRoot().getChildrenSize(),
        });
      });

      closeMenu();

      const MEDIA_CARD_TYPES = new Set([
        "image",
        "gallery",
        "video",
        "audio",
        "file",
      ]);
      if (cardType && MEDIA_CARD_TYPES.has(cardType) && requestMedia) {
        logForensicEvent("BEFORE_UPLOAD", { cardType, insertedKey });
        requestMedia({ cardType }).then((payload) => {
          logForensicEvent("AFTER_UPLOAD", {
            cardType,
            insertedKey,
            hasPayload: !!payload,
            payloadHash: payload ? hashString(JSON.stringify(payload)) : null,
          });
          if (!payload || insertedKey == null) return;
          const nodeKey = insertedKey;
          editor.update(() => {
            const node = $getNodeByKey(nodeKey);
            if (node && ($isReactStudioCardNode(node) || node instanceof StudioCardNode)) {
              const newNode = $createReactStudioCardNode(
                (node as StudioCardNode).getCardType(),
                payload,
              );
              node.replace(newNode);
            }
            logForensicEvent("AFTER_SET_CARD_DATA", {
              cardType,
              nodeKey,
              nodeFound: !!node,
              childCount: $getRoot().getChildrenSize(),
            });
          });
        });
      }
    },
    [editor, requestMedia],
  );


  return (
    <LexicalTypeaheadMenuPlugin<StudioMenuOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={checkForTriggerMatch}
      options={options}
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
      ) => {
        if (anchorElementRef.current == null || options.length === 0) {
          return null;
        }

        return createPortal(
          <div
            className="notion-slash-menu studio-glassy-menu"
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: "absolute",
              width: "330px",
              maxHeight: "350px",
              overflowY: "auto",
              zIndex: 250,
              padding: "6px",
            }}
          >
            <div className="studio-slash-header">Blocks & Cards</div>
            <ul className="studio-slash-list" role="listbox" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {options.map((option, index) => {
                const isSelected = selectedIndex === index;
                return (
                  <li
                    key={option.title}
                    role="option"
                    aria-selected={isSelected}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectOptionAndCleanUp(option)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    className={`studio-slash-item ${isSelected ? "is-selected" : ""}`}
                  >
                    <div className="studio-slash-icon">{option.icon}</div>
                    <div className="studio-slash-content">
                      <span className="studio-slash-title">{option.title}</span>
                      <span className="studio-slash-desc">
                        {option.description}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>,
          anchorElementRef.current,
        );
      }}
    />
  );
}
