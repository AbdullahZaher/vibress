import { useCallback, useMemo, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { LexicalTypeaheadMenuPlugin, MenuOption, useBasicTypeaheadTriggerMatch } from '@lexical/react/LexicalTypeaheadMenuPlugin';
import { $getSelection, $getNodeByKey, $isRangeSelection, TextNode } from 'lexical';
import { STUDIO_CARD_DEFINITIONS } from '@vibress/studio-cards';
import { $createReactStudioCardNode, $isReactStudioCardNode } from '../nodes/ReactStudioCardNode';
import { createPortal } from 'react-dom';
import { ImageIcon, Video, Images, File as FileIcon, Code, Minus, MessageSquare, Box, MousePointerClick } from 'lucide-react';

class CardMenuOption extends MenuOption {
  title: string;
  cardType: string;

  constructor(title: string, cardType: string) {
    super(title);
    this.title = title;
    this.cardType = cardType;
  }
}

export function SlashMenuPlugin({
  requestMedia,
}: {
  requestMedia?: ((req: { cardType: string }) => Promise<Record<string, unknown> | null>) | undefined;
}) {
  const [editor] = useLexicalComposerContext();
  const [queryString, setQueryString] = useState<string | null>(null);

  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch('/', {
    minLength: 0,
  });

  const options = useMemo(() => {
    const allOptions = Object.keys(STUDIO_CARD_DEFINITIONS).map(
      (type) => new CardMenuOption(type.charAt(0).toUpperCase() + type.slice(1), type)
    );

    if (!queryString) {
      return allOptions;
    }

    const regex = new RegExp(queryString, 'i');
    return allOptions.filter(
      (option) => regex.test(option.title) || regex.test(option.cardType)
    );
  }, [queryString]);

  const onSelectOption = useCallback(
    (selectedOption: CardMenuOption, nodeToRemove: TextNode | null, closeMenu: () => void) => {
      const cardType = selectedOption.cardType;
      let insertedKey: string | null = null;

      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || selectedOption == null) {
          return;
        }

        if (nodeToRemove) {
          nodeToRemove.remove();
        }

        const cardNode = $createReactStudioCardNode(cardType, {});
        selection.insertNodes([cardNode]);
        insertedKey = cardNode.getKey();
      });
      closeMenu();

      if (requestMedia) {
        requestMedia({ cardType }).then((payload) => {
          if (!payload || insertedKey == null) return;
          const nodeKey = insertedKey;
          editor.update(() => {
            const node = $getNodeByKey(nodeKey);
            if ($isReactStudioCardNode(node)) {
              node.setCardData(payload);
            }
          });
        });
      }
    },
    [editor, requestMedia]
  );

  return (
    <LexicalTypeaheadMenuPlugin<CardMenuOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={checkForTriggerMatch}
      options={options}
      menuRenderFn={(anchorElementRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => {
        if (anchorElementRef.current == null || options.length === 0) {
          return null;
        }

        const getCardIcon = (type: string) => {
          switch (type) {
            case 'image': return <ImageIcon className="w-4 h-4 opacity-70" />;
            case 'video': return <Video className="w-4 h-4 opacity-70" />;
            case 'gallery': return <Images className="w-4 h-4 opacity-70" />;
            case 'file': return <FileIcon className="w-4 h-4 opacity-70" />;
            case 'embed': return <Code className="w-4 h-4 opacity-70" />;
            case 'html': return <Code className="w-4 h-4 opacity-70" />;
            case 'divider': return <Minus className="w-4 h-4 opacity-70" />;
            case 'callout': return <MessageSquare className="w-4 h-4 opacity-70" />;
            case 'button': return <MousePointerClick className="w-4 h-4 opacity-70" />;
            default: return <Box className="w-4 h-4 opacity-70" />;
          }
        };

        return createPortal(
          <div
            className="typeahead-popover absolute z-[100] min-w-[240px] p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg"
            style={{
              top: (anchorElementRef.current.getBoundingClientRect().top ?? 0) + 30,
              left: anchorElementRef.current.getBoundingClientRect().left ?? 0,
            }}
          >
            <div className="px-2 py-1 mb-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              Insert Card
            </div>
            <ul
              className="list-none m-0 p-0 flex flex-col"
              onMouseDown={(e) => e.preventDefault()}
            >
              {options.map((option, i: number) => (
                <li
                  key={option.key}
                  tabIndex={-1}
                  className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-md text-sm font-medium transition-colors ${
                    selectedIndex === i
                      ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50'
                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                  }`}
                  onMouseEnter={() => setHighlightedIndex(i)}
                  onClick={() => selectOptionAndCleanUp(option)}
                >
                  <div className={`flex items-center justify-center w-6 h-6 rounded ${selectedIndex === i ? 'bg-white dark:bg-zinc-700 shadow-sm' : 'bg-transparent'}`}>
                    {getCardIcon(option.cardType)}
                  </div>
                  <span className="flex-1">{option.title}</span>
                </li>
              ))}
            </ul>
          </div>,
          document.body
        );
      }}
    />
  );
}
