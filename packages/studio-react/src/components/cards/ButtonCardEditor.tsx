import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { NodeKey, $getNodeByKey } from 'lexical';
import { ButtonCardData } from '@vibress/studio-cards';

interface Props {
  nodeKey: NodeKey;
  cardData: ButtonCardData;
}

export function ButtonCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);

  const text = cardData.text || '';
  const url = cardData.url || '';
  const alignment = cardData.alignment || 'center';

  const updateCardData = (updates: Partial<ButtonCardData>) => {
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

  

  const alignClass = alignment === 'left' ? 'justify-start' : alignment === 'right' ? 'justify-end' : 'justify-center';

  return (
    <div
      className={`vb-button-card relative w-full mb-4`}
      onClick={() => {
        clearSelection();
        setSelected(true);
      }}
    >
      <div 
        className={`flex w-full my-3 ${alignClass} ${isSelected || url ? 'opacity-100' : 'opacity-50'} transition-opacity`}
        style={{
          outline: isSelected ? '2px solid #3b82f6' : 'none',
          outlineOffset: '4px',
          borderRadius: '4px',
        }}
      >
        <a 
          href={url || '#'} 
          onClick={(e) => e.preventDefault()}
          className="inline-block px-5 py-3 bg-blue-600 text-white font-medium rounded-md cursor-pointer hover:bg-blue-700 select-none text-base leading-tight"
        >
          {text || 'Add button text'}
        </a>
      </div>

      {isSelected && (
        <div 
          className="absolute top-full left-1/2 -translate-x-1/2 mt-3 bg-white p-4 rounded-xl shadow-2xl border border-gray-100 z-50 w-80 flex flex-col gap-4" 
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
          onKeyPress={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">Button Text</label>
            <input
              type="text"
              value={text}
              onChange={(e) => updateCardData({ text: e.target.value })}
              placeholder="Add button text"
              className="px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-gray-400"
              onFocus={(e) => e.stopPropagation()}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">Button URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => updateCardData({ url: e.target.value })}
              placeholder="https://..."
              className="px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-gray-400"
              onFocus={(e) => e.stopPropagation()}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">Alignment</label>
            <div className="flex bg-gray-100 rounded-md p-1 border border-gray-200">
              {(['left', 'center', 'right'] as const).map((align) => (
                <button
                  key={align}
                  onClick={() => updateCardData({ alignment: align })}
                  className={`flex-1 text-sm py-1.5 rounded-sm capitalize transition-colors ${alignment === align ? 'bg-white shadow-sm text-blue-600 font-semibold' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/50'}`}
                >
                  {align}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
