import { useCallback, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { NodeKey, $getNodeByKey } from "lexical";
import { GalleryCardData, StudioCardNode } from "@vibress/studio-cards";

import { NestedCaptionEditor } from "./NestedCaptionEditor";
import { CardPlaceholder } from "../ui/CardPlaceholder";
import { useStudioMedia } from "../../media-context";
import { StudioMediaFloatingToolbar } from "../ui/StudioMediaFloatingToolbar";
import { GalleryMetadataPopover } from "../ui/media-popovers/GalleryMetadataPopover";

interface Props {
  nodeKey: NodeKey;
  cardData: GalleryCardData;
}

export function GalleryCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const { uploadMedia, requestMedia } = useStudioMedia();
  const [uploading, setUploading] = useState(false);

  const isPopulated = cardData.images && cardData.images.length > 0;

  const onFileSelect = (files: File[]) => {
    if (files.length === 0 || !uploadMedia) return;
    // Upload every file through the durable media adapter.
    setUploading(true);
    Promise.all(
      files.map((file) => uploadMedia(file, "gallery").catch(() => null)),
    )
      .then((payloads) => {
        const newImages = payloads
          .filter(
            (p): p is Record<string, unknown> =>
              !!p && typeof p.src === "string",
          )
          .map((p) => ({
            src: p.src as string,
            alt: (p.alt as string) || "",
            assetId: p.assetId as string | undefined,
          }));
        if (newImages.length === 0) return;
        editor.update(() => {
          const node = $getNodeByKey(nodeKey);
          if (node instanceof StudioCardNode) {
            node.setCardData({
              ...cardData,
              images: [...(cardData.images || []), ...newImages],
            });
          }
        });
      })
      .finally(() => setUploading(false));
  };

  const handleChangeFromLibrary = useCallback(async () => {
    if (!requestMedia) return;
    const payload = await requestMedia({
      cardType: "gallery",
      source: "library",
    });
    if (!payload) return;
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node instanceof StudioCardNode) {
        const newImages = Array.isArray(payload.images)
          ? payload.images
          : payload.src
            ? [payload]
            : [];
        node.setCardData({
          ...cardData,
          images: newImages.length > 0 ? newImages : cardData.images,
        });
      }
    });
  }, [editor, nodeKey, cardData, requestMedia]);

  const handleMetadataUpdate = useCallback(
    (data: { caption: string }) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node instanceof StudioCardNode) {
          node.setCardData({
            ...cardData,
            caption: data.caption,
            captionHtml: data.caption,
          });
        }
      });
    },
    [editor, nodeKey, cardData],
  );

  const handleWidthChange = useCallback(
    (newWidth: "regular" | "wide" | "full") => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node instanceof StudioCardNode) {
          node.setCardData({
            ...cardData,
            width: newWidth,
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

  const widthClass =
    cardData.width && cardData.width !== "regular"
      ? ` vb-width-${cardData.width}`
      : "";

  if (!isPopulated) {
    return (
      <CardPlaceholder
        iconType="gallery"
        title="Gallery"
        description="Click to select images, or drag and drop"
        onFileSelect={onFileSelect}
        multiple={true}
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
    typeof cardData.caption === "string"
      ? cardData.caption
      : cardData.captionHtml || "";

  return (
    <figure
      className={`vb-gallery-card${widthClass} relative group my-3.5`}
      onClick={() => {
        clearSelection();
        setSelected(true);
      }}
      style={{
        outline: isSelected ? "2px solid #6366f1" : "none",
        borderRadius: "12px",
        transition: "outline 0.1s ease",
      }}
    >
      <StudioMediaFloatingToolbar
        onChange={requestMedia ? handleChangeFromLibrary : undefined}
        changeLabel="Add / Change"
        changeTitle="Add or change gallery images from library"
        metadataLabel="Caption"
        metadataTitle="Edit gallery caption"
        metadataContent={
          <GalleryMetadataPopover
            caption={captionStr}
            onUpdate={handleMetadataUpdate}
            onClose={() => {}}
          />
        }
        width={cardData.width}
        onWidthChange={handleWidthChange}
        onDelete={handleDelete}
        deleteTitle="Remove gallery"
        isSelected={isSelected}
      />

      <div className="flex flex-wrap gap-2.5">
        {cardData.images.map((img, idx) => (
          <img
            key={idx}
            src={img.src}
            alt={img.alt || ""}
            className="rounded-lg object-cover max-h-[260px] flex-1"
          />
        ))}
      </div>
      <NestedCaptionEditor
        initialCaptionJSON={
          typeof cardData.caption === "object" ? cardData.caption : undefined
        }
        onChange={onCaptionChange}
        placeholder="Type caption for gallery (optional)"
      />
    </figure>
  );
}
