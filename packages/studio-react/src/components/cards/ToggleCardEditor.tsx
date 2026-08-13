import { useRef, useEffect, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { NodeKey, $getNodeByKey } from 'lexical';
import { ToggleCardData, StudioCardNode } from '@vibress/studio-cards';

import { ChevronRight } from 'lucide-react';

interface Props {
  nodeKey: NodeKey;
  cardData: ToggleCardData;
}

export function ToggleCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  const [isOpen, setIsOpen] = useState(true); // Default open in editor

  const headingRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const heading = cardData.heading || '';
  const content = cardData.content || '';

  const updateCardData = (updates: Partial<ToggleCardData>) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node instanceof StudioCardNode) {
        node.setCardData({
          ...cardData,
          ...updates,
        });
      }
    });
  };

  const adjustHeight = (ref: React.RefObject<HTMLTextAreaElement>) => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = ref.current.scrollHeight + 'px';
    }
  };

  useEffect(() => adjustHeight(headingRef), [heading]);
  useEffect(() => { if (isOpen) adjustHeight(contentRef); }, [content, isOpen]);

  return (
    <div
      className={`vb-toggle-card relative w-full my-3 border border-border/80 dark:border-white/10 rounded-xl bg-card dark:bg-[#1a1c20]/90 backdrop-blur-md text-foreground shadow-sm overflow-hidden`}
      onClick={(e) => {
        clearSelection();
        setSelected(true);
        if (!isSelected) {
          e.preventDefault();
        }
      }}
      style={{
        outline: isSelected ? '2px solid #6366f1' : 'none',
        transition: 'outline 0.1s ease',
      }}
    >
      <div className="flex items-start py-3 px-3.5">
        <button 
          className="mt-1 mr-2 text-muted-foreground hover:text-foreground transition-colors focus:outline-none"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(!isOpen);
          }}
        >
          <ChevronRight className={`w-5 h-5 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} />
        </button>
        <div className="flex-1 min-w-0">
          <textarea
             ref={headingRef}
             value={heading}
             onChange={(e) => updateCardData({ heading: e.target.value })}
             placeholder="Toggle heading..."
             className="w-full text-base font-semibold bg-transparent outline-none resize-none placeholder:text-muted-foreground text-foreground"
             rows={1}
             onFocus={(e) => e.stopPropagation()}
          />

          {isOpen && (
            <div className="mt-2 pt-2 border-t border-border/60 dark:border-white/10">
               <textarea
                 ref={contentRef}
                 value={content}
                 onChange={(e) => updateCardData({ content: e.target.value })}
                 placeholder="Toggle content..."
                 className="w-full text-sm text-foreground/90 bg-transparent outline-none resize-none placeholder:text-muted-foreground"
                 rows={2}
                 onFocus={(e) => e.stopPropagation()}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
