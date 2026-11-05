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

/** Gallery insertion accepts only durable URLs; transient preview URLs never persist. */
function isDurableGalleryUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  const url = value.trim();
  if (/[\u0000-\u001f\u007f\\]/.test(url)) return false;
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch { return false; }
}

/** Asset ID is primary identity; URL is also checked, preserving existing order. */
function appendDurableGalleryImages(
  existing: GalleryCardData["images"],
  incoming: unknown[],
): GalleryCardData["images"] {
  const seenIds = new Set(existing.map((img) => img.assetId)
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0));
  const seenUrls = new Set(existing.map((img) => img.src.trim()));
  const merged = [...existing];
  for (const item of incoming) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const value = item as Record<string, unknown>;
    if (!isDurableGalleryUrl(value.src)) continue;
    if (value.assetId !== undefined &&
        (typeof value.assetId !== "string" || !value.assetId.trim())) continue;
    const src = value.src.trim();
    const id = typeof value.assetId === "string" ? value.assetId.trim() : undefined;
    if (seenUrls.has(src) || (id && seenIds.has(id))) continue;
    merged.push({ src, alt: typeof value.alt === "string" ? value.alt : "",
      caption: "", ...(id ? { assetId: id } : {}) });
    seenUrls.add(src);
    if (id) seenIds.add(id);
  }
  return merged;
}

export function GalleryCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const { uploadMedia, requestMedia } = useStudioMedia();
  const [uploading, setUploading] = useState(false);

  const isPopulated = cardData.images && cardData.images.length > 0;

  const [pickerError, setPickerError] = useState<string | null>(null);

  const onFileSelect = (files: File[]) => {
    if (!files.length || !uploadMedia) return;
    setUploading(true);
    void Promise.all(files.map((file) =>
      uploadMedia(file, "gallery").catch(() => null),
    )).then((results) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (!(node instanceof StudioCardNode) || !node.isAttached()) return;
        const current = node.getCardData();
        const existing = Array.isArray(current.images) ? current.images as GalleryCardData["images"] : [];
        const merged = appendDurableGalleryImages(existing, results);
        if (merged.length > existing.length) node.setCardData({ ...current, images: merged });
      });
    }).finally(() => setUploading(false));
  };

  const handleChangeFromLibrary = useCallback(async () => {
    if (!requestMedia) return;
    setPickerError(null);
    try {
      const payload = await requestMedia({ cardType: "gallery", source: "library" });
      if (!payload) return; // Cancellation must not alter a gallery.
      const candidates = Array.isArray(payload.images) ? payload.images :
        payload.src ? [payload] : [];
      if (!candidates.length) return;
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (!(node instanceof StudioCardNode) || !node.isAttached()) return;
        // Read the *latest* state after the asynchronous picker returns.
        const current = node.getCardData();
        const existing = Array.isArray(current.images) ? current.images as GalleryCardData["images"] : [];
        const merged = appendDurableGalleryImages(existing, candidates);
        if (merged.length > existing.length) node.setCardData({ ...current, images: merged });
      });
    } catch {
      setPickerError("The media library failed. Your existing images were preserved.");
    }
  }, [editor, nodeKey, requestMedia]);

  const handleMetadataUpdate = useCallback(
    (data: { caption: string }) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node instanceof StudioCardNode && node.isAttached()) {
          node.setCardData({
            ...node.getCardData(),
            caption: data.caption,
            captionHtml: data.caption,
          });
        }
      });
    },
    [editor, nodeKey],
  );

  const handleWidthChange = useCallback(
    (newWidth: "regular" | "wide" | "full") => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node instanceof StudioCardNode && node.isAttached()) {
          node.setCardData({
            ...node.getCardData(),
            width: newWidth,
          });
        }
      });
    },
    [editor, nodeKey],
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
        if (node instanceof StudioCardNode && node.isAttached()) {
          node.setCardData({
            ...node.getCardData(),
            caption: captionJSON,
            captionHtml,
          });
        }
      });
    },
    [editor, nodeKey],
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
        changeLabel="Add Images"
        changeTitle="Append images from the media library"
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
      {pickerError && <div role="alert">{pickerError}</div>}
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
