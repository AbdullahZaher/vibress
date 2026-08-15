import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  apiRequest,
  ApiMediaAsset,
  uploadMediaApi,
  fetchAiStatus,
  generateAiCompletion,
} from "../lib/api";
import { VibressStudio } from "@vibress/studio-react";
import {
  StudioDocument,
  migrateDocument,
  createEmptyStudioDocument,
} from "@vibress/studio-core";
import { MediaPicker } from "./MediaPicker";

import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { ArrowLeft, Save, CheckCircle2, Clock, Settings } from "lucide-react";
import { PageSettingsSidebar } from "./editor/PageSettingsSidebar";

interface PageEditorProps {
  pageId?: string | undefined;
  currentUserId: string;
  canPublish: boolean;
  onNavigate: (path: string) => void;
}

type AutosaveState = "idle" | "saving" | "saved" | "failed" | "conflict";

export const PageEditor: React.FC<PageEditorProps> = ({
  pageId,
  currentUserId,
  canPublish,
  onNavigate,
}) => {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [canonicalUrl, setCanonicalUrl] = useState("");
  const [studioDoc, setStudioDoc] = useState<StudioDocument>(
    createEmptyStudioDocument(),
  );
  const [status, setStatus] = useState("draft");
  const [version, setVersion] = useState(1);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);

  useEffect(() => {
    fetchAiStatus()
      .then((res) => setAiEnabled(res.enabled))
      .catch(() => setAiEnabled(false));
  }, []);

  const handleAiGenerate = useCallback(
    async (prompt: string) => {
      return generateAiCompletion({
        prompt,
        context: title ? `Title: ${title}` : undefined,
        task: "inline",
      });
    },
    [title],
  );

  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [showPicker, setShowPicker] = useState(false);
  const [pickerConfig, setPickerConfig] = useState<{
    cardType: string;
    resolve: (payload: Record<string, unknown> | null) => void;
  } | null>(null);

  const handleRequestMedia = useCallback((req: { cardType: string }) => {
    const mediaTypes = ["image", "gallery", "video", "audio", "file"];
    if (!mediaTypes.includes(req.cardType)) {
      return Promise.resolve(null);
    }
    return new Promise<Record<string, unknown> | null>((resolve) => {
      setPickerConfig({ cardType: req.cardType, resolve });
      setShowPicker(true);
    });
  }, []);

  // Durable upload adapter for Studio card editors (drag/drop/file select).
  const handleUploadMedia = useCallback(
    async (file: File, cardType: string) => {
      try {
        const { media } = await uploadMediaApi(file);
        if (cardType === "image") {
          return {
            assetId: media.id,
            src: media.url,
            alt: media.displayName,
            width: media.width || undefined,
            height: media.height || undefined,
          };
        }
        if (cardType === "gallery") {
          return { assetId: media.id, src: media.url, alt: media.displayName };
        }
        if (cardType === "video") {
          return {
            assetId: media.id,
            src: media.url,
            caption: media.displayName,
          };
        }
        if (cardType === "audio") {
          return {
            assetId: media.id,
            src: media.url,
            title: media.displayName,
          };
        }
        if (cardType === "file") {
          return {
            assetId: media.id,
            src: media.url,
            fileName: media.originalFilename,
            fileSize: `${(media.sizeBytes / (1024 * 1024)).toFixed(2)} MB`,
          };
        }
        return { assetId: media.id, src: media.url };
      } catch {
        return null;
      }
    },
    [],
  );

  const handlePickerSelectAsset = (asset: ApiMediaAsset) => {
    if (!pickerConfig) return;
    let payload: Record<string, unknown> = {};
    if (pickerConfig.cardType === "image") {
      payload = {
        assetId: asset.id,
        src: asset.url,
        alt: asset.displayName,
        width: asset.width || undefined,
        height: asset.height || undefined,
      };
    } else if (pickerConfig.cardType === "video") {
      payload = {
        assetId: asset.id,
        src: asset.url,
        caption: asset.displayName,
      };
    } else if (pickerConfig.cardType === "audio") {
      payload = { assetId: asset.id, src: asset.url, title: asset.displayName };
    } else if (pickerConfig.cardType === "file") {
      payload = {
        assetId: asset.id,
        src: asset.url,
        fileName: asset.originalFilename,
        fileSize: `${asset.sizeBytes}`,
      };
    }
    pickerConfig.resolve(payload);
    setShowPicker(false);
    setPickerConfig(null);
  };

  const handlePickerSelectAssets = (assets: ApiMediaAsset[]) => {
    if (!pickerConfig) return;
    const payload = {
      images: assets.map((a) => ({
        assetId: a.id,
        src: a.url,
        alt: a.displayName,
      })),
    };
    pickerConfig.resolve(payload);
    setShowPicker(false);
    setPickerConfig(null);
  };

  const handlePickerClose = () => {
    if (pickerConfig) {
      pickerConfig.resolve(null);
    }
    setShowPicker(false);
    setPickerConfig(null);
  };

  useEffect(() => {
    if (pageId) {
      setLoading(true);
      apiRequest<{
        page: {
          id: string;
          title: string;
          slug: string;
          excerpt?: string;
          metaTitle?: string;
          metaDescription?: string;
          canonicalUrl?: string;
          content?: unknown;
          status: string;
          version: number;
        };
      }>(`/pages/${pageId}`)
        .then((res) => {
          const p = res.page;
          setTitle(p.title);
          setSlug(p.slug);
          setExcerpt(p.excerpt || "");
          setMetaTitle(p.metaTitle || "");
          setMetaDescription(p.metaDescription || "");
          setCanonicalUrl(p.canonicalUrl || "");
          setStudioDoc(migrateDocument(p.content));
          setStatus(p.status);
          setVersion(p.version);
        })
        .catch((err: { message?: string }) =>
          setErrorMsg(err.message || "Failed to load page"),
        )
        .finally(() => setLoading(false));
    }
  }, [pageId]);

  const savePage = useCallback(
    async (isAutosave = false) => {
      if (!title.trim() && isAutosave) return;
      if (autosaveState === "conflict") return;

      setErrorMsg(null);
      if (isAutosave) {
        setAutosaveState("saving");
      } else {
        setSaving(true);
      }

      const payload = {
        title: title || "Untitled Page",
        slug: slug || undefined,
        excerpt: excerpt || null,
        metaTitle: metaTitle || null,
        metaDescription: metaDescription || null,
        canonicalUrl: canonicalUrl || null,
        content: studioDoc,
        primaryAuthorId: currentUserId,
        expectedVersion: pageId ? version : undefined,
      };

      try {
        if (pageId) {
          const res = await apiRequest<{ page: { version: number } }>(
            `/pages/${pageId}`,
            {
              method: "PUT",
              body: JSON.stringify(payload),
            },
          );
          setVersion(res.page.version);
          setAutosaveState("saved");
        } else {
          const res = await apiRequest<{ page: { id: string } }>("/pages", {
            method: "POST",
            body: JSON.stringify(payload),
          });
          onNavigate(`/admin/pages/${res.page.id}`);
        }
      } catch (err: unknown) {
        const errorObj = err as { code?: string; message?: string };
        if (errorObj.code === "CONTENT_CONFLICT") {
          setAutosaveState("conflict");
          setErrorMsg("Conflict: Page modified by another request.");
        } else {
          setAutosaveState("failed");
          setErrorMsg(errorObj.message || "Save failed");
        }
      } finally {
        setSaving(false);
      }
    },
    [
      title,
      slug,
      excerpt,
      metaTitle,
      metaDescription,
      canonicalUrl,
      studioDoc,
      currentUserId,
      pageId,
      version,
      autosaveState,
      onNavigate,
    ],
  );

  const handleStudioChange = (newDoc: StudioDocument) => {
    setStudioDoc(newDoc);
    if (!pageId || autosaveState === "conflict") return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      savePage(true);
    }, 1200);
  };

  const handleManualSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    savePage(false);
  };

  const handlePublishToggle = async () => {
    if (!pageId || !canPublish) return;
    try {
      const endpoint =
        status === "published"
          ? `/pages/${pageId}/unpublish`
          : `/pages/${pageId}/publish`;
      const res = await apiRequest<{
        page: { status: string; version: number };
      }>(endpoint, { method: "POST" });
      setStatus(res.page.status);
      setVersion(res.page.version);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMsg(errorObj.message || "Publish toggle failed");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground gap-2">
        <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span>Loading page editor...</span>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-[calc(100vh-theme(spacing.16))] w-full bg-background -mt-4">
      {/* Editor Header Bar */}
      <header className="flex items-center justify-between gap-4 px-6 py-4 shrink-0 bg-background/95 backdrop-blur z-10">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onNavigate("/admin/pages")}
            className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Pages
          </Button>
          <div className="h-4 w-[1px] bg-border" />
          <Badge variant={status === "published" ? "success" : "secondary"}>
            {status.toUpperCase()}
          </Badge>
          {autosaveState === "saving" && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3 animate-spin" /> Saving...
            </span>
          )}
          {autosaveState === "saved" && (
            <span className="inline-flex items-center gap-1 text-xs text-foreground font-mono font-medium">
              <CheckCircle2 className="h-3 w-3" /> Saved
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {pageId && canPublish && (
            <Button
              variant="outline"
              size="sm"
              onClick={handlePublishToggle}
              className="text-xs"
            >
              {status === "published" ? "Unpublish" : "Publish Page"}
            </Button>
          )}

          <Button
            onClick={handleManualSave}
            disabled={saving || autosaveState === "conflict"}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs gap-1.5 shadow-sm"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving..." : pageId ? "Update Page" : "Create Page"}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSettings(true)}
            className="ml-2 text-muted-foreground hover:text-foreground"
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Main Canvas */}
      <main className="flex-1 overflow-y-auto px-6 py-12 pb-32">
        <div className="max-w-[740px] mx-auto space-y-8">
          {autosaveState === "conflict" && (
            <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-sm flex items-center justify-between">
              <div>
                <strong>Version Conflict Detected:</strong> This page was updated in another session.
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
                className="h-8 text-xs font-semibold ml-4 shrink-0"
              >
                Reload Latest
              </Button>
            </div>
          )}

          {errorMsg && (
            <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium">
              {errorMsg}
            </div>
          )}

          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Page Title"
            aria-label="Page Title"
            className="w-full text-5xl font-bold bg-transparent border-none outline-none resize-none overflow-hidden focus:ring-0 placeholder:text-muted-foreground/30 leading-tight p-0"
            rows={1}
            onInput={(e) => {
              e.currentTarget.style.height = "auto";
              e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
            }}
          />

          <VibressStudio
            value={studioDoc}
            onChange={handleStudioChange}
            requestMedia={handleRequestMedia}
            uploadMedia={handleUploadMedia}
            enableAi={aiEnabled}
            onAiGenerate={handleAiGenerate}
          />
        </div>
      </main>

      <PageSettingsSidebar
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        pageTitle={title}
        contentContext={excerpt}
        slug={slug}
        setSlug={setSlug}
        excerpt={excerpt}
        setExcerpt={setExcerpt}
        metaTitle={metaTitle}
        setMetaTitle={setMetaTitle}
        metaDescription={metaDescription}
        setMetaDescription={setMetaDescription}
        canonicalUrl={canonicalUrl}
        setCanonicalUrl={setCanonicalUrl}
      />

      {/* Media Modal */}
      {showPicker && (
        <MediaPicker
          allowedTypes={
            pickerConfig?.cardType === "gallery"
              ? ["image"]
              : [pickerConfig?.cardType as "image" | "video" | "audio" | "file"]
          }
          multiple={pickerConfig?.cardType === "gallery"}
          onSelectAsset={handlePickerSelectAsset}
          onSelectAssets={handlePickerSelectAssets}
          onClose={handlePickerClose}
        />
      )}
    </div>
  );
};
