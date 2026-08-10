import { useCallback } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { NodeKey, $getNodeByKey } from 'lexical';
import { AudioCardData } from '@vibress/studio-cards';
import { NestedCaptionEditor } from './NestedCaptionEditor';
import { CardPlaceholder } from '../ui/CardPlaceholder';

interface Props {
  nodeKey: NodeKey;
  cardData: AudioCardData;
}

export function AudioCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);

  const isPopulated = !!cardData.src;

  const onFileSelect = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const url = URL.createObjectURL(file); // Temporary URL until API is integrated
      
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node && 'setCardData' in node) {
          (node as any).setCardData({
            ...cardData,
            src: url,
            title: file.name
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
        iconType="audio"
        title="Audio"
        description="Click to select an audio file, or drag and drop"
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
      className={`vb-audio-card relative flex flex-col gap-2 p-4 border rounded-md`}
      onClick={() => {
        clearSelection();
        setSelected(true);
      }}
      style={{
        outline: isSelected ? '2px solid #3b82f6' : 'none',
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
