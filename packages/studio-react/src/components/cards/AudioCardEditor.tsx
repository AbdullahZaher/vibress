import { useCallback, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { NodeKey, $getNodeByKey } from "lexical";
import { AudioCardData, StudioCardNode } from "@vibress/studio-cards";

import { NestedCaptionEditor } from "./NestedCaptionEditor";
import { CardPlaceholder } from "../ui/CardPlaceholder";
import { useStudioMedia } from "../../media-context";
import { StudioMediaFloatingToolbar } from "../ui/StudioMediaFloatingToolbar";
import { AudioMetadataPopover } from "../ui/media-popovers/AudioMetadataPopover";

interface Props {
  nodeKey: NodeKey;
  cardData: AudioCardData;
}

export function AudioCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const { uploadMedia, requestMedia } = useStudioMedia();
  const [uploading, setUploading] = useState(false);

  const isPopulated = !!cardData.src;

  const onFileSelect = (files: File[]) => {
    const file = files[0];
    if (!file || !uploadMedia) return;
    setUploading(true);
    uploadMedia(file, "audio")
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

  const handleChangeFromLibrary = useCallback(async () => {
    if (!requestMedia) return;
    const payload = await requestMedia({
      cardType: "audio",
      source: "library",
    });
    if (!payload) return;
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node instanceof StudioCardNode) {
        node.setCardData({
          ...cardData,
          ...payload,
        });
      }
    });
  }, [editor, nodeKey, cardData, requestMedia]);

  const handleMetadataUpdate = useCallback(
    (data: { title: string; caption: string }) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node instanceof StudioCardNode) {
          node.setCardData({
            ...cardData,
            title: data.title,
            caption: data.caption,
          });
        }
      });
    },
    [editor, nodeKey, cardData],
  );

  const handleDelete = useCallback(() => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node) {
        node.remove();
      }
    });
  }, [editor, nodeKey]);

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
    [editor, nodeKey, cardData],
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

  const captionStr =
    typeof cardData.caption === "string" ? cardData.caption : "";

  return (
    <figure
      className={`vb-audio-card relative group flex flex-col gap-2 p-4 my-3.5 border border-border/80 dark:border-white/10 rounded-xl bg-card dark:bg-[#1a1c20]/90 backdrop-blur-md shadow-sm`}
      onClick={() => {
        clearSelection();
        setSelected(true);
      }}
      style={{
        outline: isSelected ? "2px solid #6366f1" : "none",
        transition: "outline 0.1s ease",
      }}
    >
      <StudioMediaFloatingToolbar
        onChange={requestMedia ? handleChangeFromLibrary : undefined}
        changeLabel="Change"
        changeTitle="Change audio file from library"
        metadataLabel="Title / Caption"
        metadataTitle="Edit audio title and caption"
        metadataContent={
          <AudioMetadataPopover
            title={cardData.title || ""}
            caption={captionStr}
            onUpdate={handleMetadataUpdate}
            onClose={() => {}}
          />
        }
        onDelete={handleDelete}
        deleteTitle="Remove audio"
        isSelected={isSelected}
      />

      {cardData.title && (
        <div className="text-sm font-semibold">{cardData.title}</div>
      )}
      <audio src={cardData.src} controls className="w-full" />
      <NestedCaptionEditor
        initialCaptionJSON={
          typeof cardData.caption === "object" ? cardData.caption : undefined
        }
        onChange={onCaptionChange}
        placeholder="Type caption for audio (optional)"
      />
    </figure>
  );
}

