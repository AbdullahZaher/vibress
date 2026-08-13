import { useCallback, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { NodeKey, $getNodeByKey } from 'lexical';
import { FileCardData, StudioCardNode } from '@vibress/studio-cards';

import { NestedCaptionEditor } from './NestedCaptionEditor';
import { CardPlaceholder } from '../ui/CardPlaceholder';
import { useStudioUpload } from '../../upload-context';
import { File as FileIcon, Download } from 'lucide-react';

interface Props {
  nodeKey: NodeKey;
  cardData: FileCardData;
}

export function FileCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  const { uploadMedia } = useStudioUpload();
  const [uploading, setUploading] = useState(false);

  const isPopulated = !!cardData.src;

  const onFileSelect = (files: File[]) => {
    const file = files[0];
    if (!file || !uploadMedia) return;
    setUploading(true);
    uploadMedia(file, 'file')
      .then((payload) => {
        if (!payload) return;
        editor.update(() => {
          const node = $getNodeByKey(nodeKey);
          if (node instanceof StudioCardNode) {
            node.setCardData({ ...cardData, ...payload });
          }
        });
      })
      .finally(() => setUploading(false));
  };

  const onCaptionChange = useCallback(
    (captionJSON: Record<string, unknown>, captionHtml: string) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node instanceof StudioCardNode) {
          node.setCardData({
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
        uploading={uploading}
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
