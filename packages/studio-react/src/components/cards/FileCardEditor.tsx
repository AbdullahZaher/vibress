import { useCallback } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { NodeKey, $getNodeByKey } from 'lexical';
import { FileCardData } from '@vibress/studio-cards';
import { NestedCaptionEditor } from './NestedCaptionEditor';
import { CardPlaceholder } from '../ui/CardPlaceholder';
import { File as FileIcon, Download } from 'lucide-react';

interface Props {
  nodeKey: NodeKey;
  cardData: FileCardData;
}

export function FileCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);

  const isPopulated = !!cardData.src;

  const onFileSelect = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const url = URL.createObjectURL(file); // Temporary URL until API is integrated
    const fileSize = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
      
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node && 'setCardData' in node) {
          (node as any).setCardData({
            ...cardData,
            src: url,
            fileName: file.name,
            fileSize
          });
        }
      });
  };

  const onCaptionChange = useCallback(
    (captionJSON: Record<string, any>, captionHtml: string) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node && 'setCardData' in node) {
          (node as any).setCardData({
            ...cardData,
            caption: captionJSON,
            captionHtml,
          });
        }
      });
    },
    [editor, nodeKey, cardData]
  );

  if (!isPopulated) {
    return (
      <CardPlaceholder
        iconType="file"
        title="File"
        description="Click to select a file, or drag and drop"
        onFileSelect={onFileSelect}
        isSelected={isSelected}
        onClick={() => {
          clearSelection();
          setSelected(true);
        }}
      />
    );
  }

  return (
    <figure
      className={`vb-file-card relative`}
      onClick={() => {
        clearSelection();
        setSelected(true);
      }}
      style={{
        outline: isSelected ? '2px solid #3b82f6' : 'none',
        transition: 'outline 0.1s ease',
      }}
    >
      <div className="flex items-center gap-4 p-4 border rounded-md bg-gray-50 mb-2">
        <FileIcon className="text-gray-500 flex-shrink-0" size={32} />
        <div className="flex-1 overflow-hidden">
          <div className="font-semibold truncate">{cardData.fileName}</div>
          <div className="text-sm text-gray-500">{cardData.fileSize}</div>
        </div>
        <div className="p-2 bg-white border rounded shadow-sm flex-shrink-0">
          <Download size={20} className="text-gray-700" />
        </div>
      </div>
      <NestedCaptionEditor
        initialCaptionJSON={typeof cardData.caption === 'object' ? cardData.caption : undefined}
        onChange={onCaptionChange}
        placeholder="Type caption for file (optional)"
      />
    </figure>
  );
}
