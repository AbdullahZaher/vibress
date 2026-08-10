import { useRef, useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { NodeKey, $getNodeByKey } from 'lexical';
import { CalloutCardData } from '@vibress/studio-cards';

interface Props {
  nodeKey: NodeKey;
  cardData: CalloutCardData;
}

const BG_COLORS: Record<string, string> = {
  grey: 'bg-gray-100 text-gray-900 border-gray-200',
  blue: 'bg-blue-50 text-blue-900 border-blue-200',
  green: 'bg-green-50 text-green-900 border-green-200',
  yellow: 'bg-yellow-50 text-yellow-900 border-yellow-200',
  red: 'bg-red-50 text-red-900 border-red-200',
  pink: 'bg-pink-50 text-pink-900 border-pink-200',
  purple: 'bg-purple-50 text-purple-900 border-purple-200',
};

export function CalloutCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const text = cardData.text || '';
  const emoji = cardData.emoji || '💡';
  const bgColor = cardData.backgroundColor || 'grey';

  const updateCardData = (updates: Partial<CalloutCardData>) => {
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

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [text]);

  const colorClass = BG_COLORS[bgColor] || BG_COLORS.grey;

  return (
    <div
      className={`vb-callout-card relative w-full mb-4 rounded-md border p-4 flex gap-4 ${colorClass}`}
      onClick={(e) => {
        clearSelection();
        setSelected(true);
        if (!isSelected) {
          e.preventDefault(); // Prevent immediately focusing textarea if just selecting
        }
      }}
      style={{
        outline: isSelected ? '2px solid #3b82f6' : 'none',
        transition: 'outline 0.1s ease',
      }}
    >
      <div className="flex-shrink-0 text-2xl leading-none flex items-start pt-0.5">
        <input
          type="text"
          value={emoji}
          onChange={(e) => {
             const val = e.target.value;
             const newEmoji = (val.trim() ? Array.from(val.trim())[0] : '💡') || '💡';
             updateCardData({ emoji: newEmoji });
          }}
          className="w-7 h-7 bg-transparent border-none outline-none text-center rounded focus:ring-2 focus:ring-blue-400"
          onFocus={(e) => {
             e.stopPropagation();
             e.target.select();
          }}
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
          onKeyPress={(e) => e.stopPropagation()}
        />
      </div>
      
      <div className="flex-1 min-w-0">
        <textarea
           ref={textareaRef}
           value={text}
           onChange={(e) => updateCardData({ text: e.target.value })}
           placeholder="Type callout text here..."
           className="w-full bg-transparent outline-none resize-none placeholder-current opacity-70 focus:opacity-100"
           rows={1}
           onFocus={(e) => e.stopPropagation()}
           onKeyDown={(e) => e.stopPropagation()}
           onKeyUp={(e) => e.stopPropagation()}
           onKeyPress={(e) => e.stopPropagation()}
        />
      </div>

      {isSelected && (
        <div className="absolute top-full right-0 mt-2 bg-white p-2 rounded-lg shadow-xl border border-gray-200 z-10 flex gap-1" onClick={(e) => e.stopPropagation()}>
          {Object.keys(BG_COLORS).map((color) => (
            <button
              key={color}
              onClick={() => updateCardData({ backgroundColor: color })}
              className={`w-6 h-6 rounded-full border ${(BG_COLORS[color] || '').split(' ')[0]} ${bgColor === color ? 'ring-2 ring-offset-1 ring-blue-500' : 'hover:scale-110 transition-transform'}`}
              title={color}
            />
          ))}
        </div>
      )}
    </div>
  );
}
