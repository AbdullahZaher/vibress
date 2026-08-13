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
      className={`vb-file-card relative my-3`}
      onClick={() => {
        clearSelection();
        setSelected(true);
      }}
      style={{
        outline: isSelected ? '2px solid #6366f1' : 'none',
        transition: 'outline 0.1s ease',
      }}
    >
      <div className="flex items-center gap-3.5 py-2.5 px-3.5 border border-border/80 dark:border-white/10 rounded-xl bg-card dark:bg-[#1a1c20]/90 backdrop-blur-md text-foreground shadow-sm">
        <div className="w-9 h-9 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center flex-shrink-0">
          <FileIcon size={20} />
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="font-semibold text-sm truncate text-foreground">{cardData.fileName}</div>
          <div className="text-xs text-muted-foreground">{cardData.fileSize}</div>
        </div>
        <div className="p-2 bg-muted/60 dark:bg-white/[0.08] border border-border/60 dark:border-white/10 rounded-lg shadow-sm flex-shrink-0 text-muted-foreground">
          <Download size={16} />
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
