import { useRef, useEffect, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { NodeKey, $getNodeByKey } from 'lexical';
import { ToggleCardData } from '@vibress/studio-cards';
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
      if (node && 'setCardData' in node) {
        (node as any).setCardData({
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
      className={`vb-toggle-card relative w-full mb-4 border rounded-md bg-white shadow-sm overflow-hidden`}
      onClick={(e) => {
        clearSelection();
        setSelected(true);
        if (!isSelected) {
          e.preventDefault();
        }
      }}
      style={{
        outline: isSelected ? '2px solid #3b82f6' : 'none',
        transition: 'outline 0.1s ease',
      }}
    >
      <div className="flex items-start p-4">
        <button 
          className="mt-1 mr-2 text-gray-400 hover:text-gray-700 transition-colors focus:outline-none"
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
             className="w-full text-lg font-semibold bg-transparent outline-none resize-none placeholder-gray-400"
             rows={1}
             onFocus={(e) => e.stopPropagation()}
          />
          
          {isOpen && (
            <div className="mt-2 pt-2 border-t border-gray-100">
               <textarea
                 ref={contentRef}
                 value={content}
                 onChange={(e) => updateCardData({ content: e.target.value })}
                 placeholder="Toggle content..."
                 className="w-full text-gray-700 bg-transparent outline-none resize-none placeholder-gray-400"
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
