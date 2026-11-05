import { useAdminLocale } from "../lib/admin-locale";
import { EditorialAutosaveGenerations } from "../lib/editorial-autosave-generations";
import { StudioDocumentRecovery } from "./editor/StudioDocumentRecovery";
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
  StudioMigrationError,
  createEmptyStudioDocument,
} from "@vibress/studio-core";
import { MediaPicker } from "./MediaPicker";

import { Button } from "./ui/button";
import { ChevronLeft, PanelRight, Clock } from "lucide-react";
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
  const { tr } = useAdminLocale();
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
  const [loading, setLoading] = useState(Boolean(pageId));
  const [autosaveState, setAutosaveState] = useState<AutosaveState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [unsupportedSource, setUnsupportedSource] = useState<unknown | null>(null);
  const [unsupportedMessage, setUnsupportedMessage] = useState<string | null>(null);
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
  // A timer created during an editor change must save the latest document, not
  // the state captured by the render that scheduled it.
  const latestStudioDocRef = useRef(studioDoc);
  const latestVersionRef = useRef(version);
  const editGenerationsRef = useRef(new EditorialAutosaveGenerations());
  const pendingLocalEditsRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const saveQueuedRef = useRef(false);
  const savePageRef = useRef<(isAutosave?: boolean) => Promise<void>>(async () => {});
  const conflictRef = useRef(false);
  const createdPageRef = useRef<{ id: string; version: number } | null>(null);
  const activePageIdRef = useRef(pageId);
  activePageIdRef.current = pageId;
  const latestMetadataRef = useRef({ title, slug, excerpt, metaTitle, metaDescription, canonicalUrl });
  latestMetadataRef.current = { title, slug, excerpt, metaTitle, metaDescription, canonicalUrl };

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!pendingLocalEditsRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    latestStudioDocRef.current = studioDoc;
  }, [studioDoc]);

  useEffect(() => {
    latestVersionRef.current = version;
  }, [version]);

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
          try {
            const migrated = migrateDocument(p.content);
            setStudioDoc(migrated);
            setUnsupportedSource(null);
            setUnsupportedMessage(null);
          } catch (error) {
            if (error instanceof StudioMigrationError) {
              setUnsupportedSource(p.content);
              setUnsupportedMessage(error.message);
            } else {
              throw error;
            }
          }
          setStatus(p.status);
          setVersion(p.version);
          latestVersionRef.current = p.version;
          conflictRef.current = false;
        })
        .catch((err: { message?: string }) =>
          setErrorMsg(err.message || "Failed to load page"),
        )
        .finally(() => setLoading(false));
    }
  }, [pageId]);

  const savePage = useCallback(
    async (isAutosave = false) => {
      const fields = latestMetadataRef.current;
      if (isAutosave && !(pageId || createdPageRef.current)) return;
      if (conflictRef.current) return;
      // Serializing requests avoids false optimistic-version conflicts and
      // ensures that responses cannot update the revision out of order.
      if (saveInFlightRef.current) {
        saveQueuedRef.current = true;
        return;
      }

      const ticket = editGenerationsRef.current.beginSave();
      const submittedDoc = latestStudioDocRef.current;
      const metadataSnapshot = { ...fields };
      const submittedPageId = pageId ?? createdPageRef.current?.id;
      const originatingPageId = pageId;
      const payload = {
        title: metadataSnapshot.title || "Untitled Page",
        slug: metadataSnapshot.slug || undefined,
        excerpt: metadataSnapshot.excerpt || null,
        metaTitle: metadataSnapshot.metaTitle || null,
        metaDescription: metadataSnapshot.metaDescription || null,
        canonicalUrl: metadataSnapshot.canonicalUrl || null,
        content: submittedDoc,
        primaryAuthorId: currentUserId,
        expectedVersion: submittedPageId ? latestVersionRef.current : undefined,
      };

      saveInFlightRef.current = true;
      setErrorMsg(null);
      if (isAutosave) setAutosaveState("saving");
      else setSaving(true);

      try {
        if (submittedPageId) {
          const res = await apiRequest<{ page: { version: number } }>(
            `/pages/${submittedPageId}`,
            { method: "PUT", body: JSON.stringify(payload) },
          );
          if (activePageIdRef.current !== originatingPageId) return;
          const acknowledgement = editGenerationsRef.current.acknowledge(ticket);
          if (!acknowledgement.latestRequest || res.page.version < latestVersionRef.current) return;
          latestVersionRef.current = res.page.version;
          setVersion(res.page.version);
          if (acknowledgement.latestEdit) {
            pendingLocalEditsRef.current = false;
            setAutosaveState("saved");
            if (!pageId && createdPageRef.current?.id === submittedPageId) {
              createdPageRef.current = null;
              onNavigate(`/admin/pages/${submittedPageId}`);
            }
          } else {
            // This response only saved the captured snapshot; a newer author
            // change still needs to be persisted.
            pendingLocalEditsRef.current = true;
            saveQueuedRef.current = true;
            setAutosaveState("idle");
          }
        } else {
          const res = await apiRequest<{ page: { id: string; version: number } }>("/pages", {
            method: "POST",
            body: JSON.stringify(payload),
          });
          if (activePageIdRef.current !== originatingPageId) return;
          if (!res.page.id || !Number.isSafeInteger(res.page.version)) {
            throw new Error("The server did not return a recoverable page ID and revision.");
          }
          createdPageRef.current = { id: res.page.id, version: res.page.version };
          latestVersionRef.current = res.page.version;
          if (editGenerationsRef.current.isCurrent(ticket)) {
            pendingLocalEditsRef.current = false;
            createdPageRef.current = null;
            onNavigate(`/admin/pages/${res.page.id}`);
          } else {
            pendingLocalEditsRef.current = true;
            saveQueuedRef.current = true;
            setAutosaveState("idle");
            setErrorMsg("Page created, but newer edits are not yet saved. Stay in this editor until the latest draft is saved.");
          }
        }
      } catch (err: unknown) {
        if (activePageIdRef.current !== originatingPageId) return;
        saveQueuedRef.current = false; // Failures require explicit retry, not an infinite loop.
        const errorObj = err as { code?: string; message?: string };
        pendingLocalEditsRef.current = true;
        if (errorObj.code === "CONTENT_CONFLICT") {
          conflictRef.current = true;
          setAutosaveState("conflict");
          setErrorMsg("Conflict: Page modified by another request. Your draft remains in the editor.");
        } else {
          setAutosaveState("failed");
          setErrorMsg(errorObj.message || "Save failed. Your draft remains in the editor.");
        }
      } finally {
        saveInFlightRef.current = false;
        setSaving(false);
        if (activePageIdRef.current === originatingPageId && !conflictRef.current &&
            pendingLocalEditsRef.current && saveQueuedRef.current &&
            (submittedPageId || createdPageRef.current?.id)) {
          saveQueuedRef.current = false;
          if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
          autosaveTimerRef.current = setTimeout(() => { void savePageRef.current(true); }, 1200);
        }
      }
    },
    [pageId, currentUserId, onNavigate],
  );

  savePageRef.current = savePage;

  const schedulePageAutosave = () => {
    editGenerationsRef.current.markEdited();
    pendingLocalEditsRef.current = true;
    setAutosaveState((state) => state === "conflict" ? state : "idle");
    if (!(pageId || createdPageRef.current) || conflictRef.current) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => { void savePage(true); }, 1200);
  };

  const handleStudioChange = (newDoc: StudioDocument) => {
    latestStudioDocRef.current = newDoc;
    setStudioDoc(newDoc);
    schedulePageAutosave();
  };

  const handleManualSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    void savePage(false);
  };

  const navigateSafely = (path: string) => {
    if (pendingLocalEditsRef.current &&
        !window.confirm("This page has unsaved changes. Leave without saving?")) return;
    onNavigate(path);
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

  if (!loading && unsupportedMessage) {
    return (
      <StudioDocumentRecovery message={unsupportedMessage}
        rawDocument={unsupportedSource} resourceLabel="page" />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground gap-2">
        <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span>{tr("Loading page editor...")}</span>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-background">
      {/* Editor Header Bar — Minimalist Ghost-style toolbar */}
      <header className="flex h-16 items-center justify-between px-6 sm:px-10 md:px-14 shrink-0 bg-background/95 backdrop-blur z-10 border-b border-border/20">
        {/* Left: Back to Pages & Page State */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigateSafely("/admin/pages")}
            className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors group focus:outline-none"
            aria-label={tr("Back to Pages")}
          >
            <ChevronLeft className="h-4 w-4 rtl:rotate-180 transition-transform group-hover:-translate-x-0.5 rtl:group-hover:translate-x-0.5" />
            <span>{tr("Pages")}</span>
          </button>

          <span className="text-muted-foreground/30 font-light select-none">|</span>

          {/* Status badge */}
          {!pageId ? (
            <span className="text-xs text-muted-foreground/80 font-normal">{tr("New")}</span>
          ) : (
            <div className="inline-flex items-center gap-1.5 text-xs">
              {autosaveState === "saving" && (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Clock className="h-3 w-3 animate-spin" /> {tr("Saving...")}
                </span>
              )}
              {autosaveState === "saved" && (
                <span className="text-muted-foreground/80 font-normal">
                  {status === "published" ? tr("Published") : tr("Draft - Saved")}
                </span>
              )}
              {autosaveState === "idle" && (
                <span className="text-muted-foreground/80 font-normal">
                  {status === "published" ? tr("Published") : tr("Draft")}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right: Actions & Settings Panel Toggle */}
        <div className="flex items-center gap-2">
          {pageId && canPublish && status !== "published" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePublishToggle}
              disabled={autosaveState === "conflict"}
              loading={saving}
              loadingLabel={tr("Publishing...")}
              className="h-8 px-3 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 hover:bg-emerald-500/10 transition"
            >
              {tr("Publish Page")}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleManualSave}
              disabled={autosaveState === "conflict"}
              loading={saving}
              loadingLabel={tr("Saving...")}
              className="h-8 px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition"
            >
              {pageId ? tr("Update Page") :
                createdPageRef.current ? tr("Save Latest Changes") : tr("Create Page")}
            </Button>
          )}

          {/* Ghost Settings Panel Toggle (◫) */}
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            aria-label={tr("Page settings")}
            title={tr("Page settings")}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus:outline-none ${
              showSettings
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <PanelRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Main Canvas — Centered 760px editorial column */}
      <main className="min-h-0 flex-1 overflow-y-auto px-6 sm:px-12 md:px-16 pt-12 sm:pt-16 md:pt-20 pb-48">
        <div className="w-full max-w-[760px] mx-auto space-y-8">
          {autosaveState === "conflict" && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-sm flex items-center justify-between">
              <div>
                <strong>{tr("Version Conflict Detected:")}</strong> {tr("This content was updated in another session.")}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
                className="ms-4 shrink-0"
              >
                {tr("Reload Latest")}
              </Button>
            </div>
          )}

          {errorMsg && (
            <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium">
              {errorMsg}
            </div>
          )}

          <div>
            <textarea
              value={title}
              onChange={(e) => { setTitle(e.target.value); schedulePageAutosave(); }}
              placeholder={tr("Page title")}
              aria-label={tr("Page title")}
              className="w-full text-4xl sm:text-5xl font-extrabold bg-transparent border-none outline-none resize-none overflow-hidden focus:ring-0 placeholder:text-muted-foreground/30 leading-tight p-0 text-foreground tracking-tight"
              rows={1}
              onInput={(e) => {
                e.currentTarget.style.height = "auto";
                e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
              }}
            />
          </div>

          <VibressStudio
            // Keep Lexical mounted across autosave and publish version bumps.
            key={pageId || "new"}
            value={studioDoc}
            onChange={handleStudioChange}
            placeholder={tr("Begin writing your page...")}
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
        setSlug={(next) => { setSlug(next); schedulePageAutosave(); }}
        excerpt={excerpt}
        setExcerpt={(next) => { setExcerpt(next); schedulePageAutosave(); }}
        metaTitle={metaTitle}
        setMetaTitle={(next) => { setMetaTitle(next); schedulePageAutosave(); }}
        metaDescription={metaDescription}
        setMetaDescription={(next) => { setMetaDescription(next); schedulePageAutosave(); }}
        canonicalUrl={canonicalUrl}
        setCanonicalUrl={(next) => { setCanonicalUrl(next); schedulePageAutosave(); }}
        pageId={pageId}
        onNavigate={navigateSafely}
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
