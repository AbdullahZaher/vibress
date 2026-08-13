import { useCallback, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { NodeKey, $getNodeByKey } from 'lexical';
import { AudioCardData, StudioCardNode } from '@vibress/studio-cards';

import { NestedCaptionEditor } from './NestedCaptionEditor';
import { CardPlaceholder } from '../ui/CardPlaceholder';
import { useStudioUpload } from '../../upload-context';

interface Props {
  nodeKey: NodeKey;
  cardData: AudioCardData;
}

export function AudioCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  const { uploadMedia } = useStudioUpload();
  const [uploading, setUploading] = useState(false);

  const isPopulated = !!cardData.src;

  const onFileSelect = (files: File[]) => {
    const file = files[0];
    if (!file || !uploadMedia) return;
    setUploading(true);
    uploadMedia(file, 'audio')
      .then((payload) => {
        if (!payload) return;
        editor.update(() => {
          const node = $getNodeByKey(nodeKey);
          if (node instanceof StudioCardNode) {
            node.setCardData({ ...cardData, ...payload, title: file.name });
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
        iconType="audio"
        title="Audio"
        description="Click to select an audio file, or drag and drop"
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
      className={`vb-audio-card relative flex flex-col gap-2 p-4 my-3.5 border border-border/80 dark:border-white/10 rounded-xl bg-card dark:bg-[#1a1c20]/90 backdrop-blur-md shadow-sm`}
      onClick={() => {
        clearSelection();
        setSelected(true);
      }}
      style={{
        outline: isSelected ? '2px solid #6366f1' : 'none',
        transition: 'outline 0.1s ease',
      }}
    >
      {cardData.title && <div className="text-sm font-semibold">{cardData.title}</div>}
      <audio src={cardData.src} controls className="w-full" />
      <NestedCaptionEditor
        initialCaptionJSON={typeof cardData.caption === 'object' ? cardData.caption : undefined}
        onChange={onCaptionChange}
        placeholder="Type caption for audio (optional)"
      />
    </figure>
  );
}
