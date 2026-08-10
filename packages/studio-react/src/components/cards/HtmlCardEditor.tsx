import { useRef, useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { NodeKey, $getNodeByKey } from 'lexical';
import { HtmlCardData } from '@vibress/studio-cards';

interface Props {
  nodeKey: NodeKey;
  cardData: HtmlCardData;
}

export function HtmlCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const html = cardData.html || '';

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node && 'setCardData' in node) {
        (node as any).setCardData({
          ...cardData,
          html: value,
        });
      }
    });
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [html]);

  return (
    <div
      className={`vb-html-card relative w-full mb-4 border rounded-md bg-gray-50 overflow-hidden shadow-sm`}
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
      <div className="bg-gray-100 border-b px-3 py-1 flex items-center justify-between select-none">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">HTML</span>
      </div>
      <div className="p-3">
        {isSelected ? (
          <textarea
            ref={textareaRef}
            value={html}
            onChange={handleTextChange}
            placeholder="Type your HTML here..."
            className="w-full font-mono text-sm bg-transparent outline-none resize-none text-blue-800"
            rows={Math.max(3, html.split('\n').length)}
            onFocus={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onKeyUp={(e) => e.stopPropagation()}
            onKeyPress={(e) => e.stopPropagation()}
          />
        ) : (
          <div className="font-mono text-sm text-blue-800 whitespace-pre-wrap">
            {html || <span className="text-gray-400 italic">Empty HTML block</span>}
          </div>
        )}
      </div>
    </div>
  );
}
