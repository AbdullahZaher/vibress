import { useAdminLocale } from "../lib/admin-locale";
import { EditorialAutosaveGenerations } from "../lib/editorial-autosave-generations";
import { StudioDocumentRecovery } from "./editor/StudioDocumentRecovery";
import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  apiRequest,
  ApiMediaAsset,
  ApiError,
  uploadMediaApi,
  fetchAiStatus,
  generateAiCompletion,
  getActivePublicationId,
} from "../lib/api";
import {
  VibressStudio,
  WebSocketCollaborationProvider,
  YDoc,
  type CollaborationConfig,
} from "@vibress/studio-react";
import {
  StudioDocument,
  assertStudioDocumentEditable,
  migrateDocument,
  StudioMigrationError,
  createEmptyStudioDocument,
} from "@vibress/studio-core";
import { logForensicEvent, extractDocStats } from "@vibress/studio-utils";
import { MediaPicker } from "./MediaPicker";

import { Button } from "./ui/button";
import {
  ChevronLeft,
  PanelRight,
  AlertCircle,
  AlertTriangle,
  Download,
  Clock,
} from "lucide-react";
import { canApplyRemoteReplacement } from "../lib/recovery/remote-replacement-guard";
import {
  indexedDbDraftStore,
  type DraftPersistenceStatus,
  type OfflineDraftMetadata,
  type OfflineDraftRecord,
} from "../lib/recovery/indexed-db-draft-store";
import { PostSettingsSidebar } from "./editor/PostSettingsSidebar";
import { EditorialCollaborationPanel } from "./editor/EditorialCollaborationPanel";
import { RevisionDiffModal } from "./editor/RevisionDiffModal";
import { transitionPostWorkflow } from "../lib/api/collaboration";
import { PostFeatureImageControl } from "./editor/PostFeatureImageControl";
import { UnsplashModal } from "./editor/UnsplashModal";
import type { UnsplashSelectResponse } from "../lib/api/unsplash";

interface AdminPostDetail {
  id: string;
  publicationId?: string;
  title: string;
  slug: string;
  excerpt: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  status: string;
  featured?: boolean;
  scheduledAt: string | null;
  version: number;
  content: unknown;
  contentJson: unknown;
  featureImageId?: string | null;
  featureImageAlt?: string | null;
  featureImageCaption?: string | null;
  featureImage?: ApiMediaAsset | null;
  tags?: Tag[];
}

interface PostEditorProps {
  postId?: string | undefined;
  currentUserId: string;
  canPublish: boolean;
  /** Select only when mounting a host-owned non-collaborative editing session.
   * Default stays collaborative; this is not a live-session restore bypass. */
  enableCollaboration?: boolean | undefined;
  onNavigate: (path: string) => void;
}

interface Tag {
  id: string;
  name: string;
}

interface Revision {
  id: string;
  revisionNumber: number;
  title: string;
  createdAt: string;
}

type AutosaveState = "idle" | "saving" | "saved" | "failed" | "conflict";
type LocalDurabilityUiState = "idle" | "pending" | DraftPersistenceStatus;

export const PostEditor: React.FC<PostEditorProps> = ({
  postId,
  currentUserId,
  canPublish,
  enableCollaboration = true,
  onNavigate,
}) => {
  const { tr, locale } = useAdminLocale();
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
  const [featured, setFeatured] = useState(false);
  const [version, setVersion] = useState(1);
  const [restoreKey, setRestoreKey] = useState(0);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [scheduledAtStr, setScheduledAtStr] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showCollabPanel, setShowCollabPanel] = useState(false);
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [availableRecoveryDraft, setAvailableRecoveryDraft] =
    useState<OfflineDraftRecord | null>(null);
  const [localDurabilityState, setLocalDurabilityState] =
    useState<LocalDurabilityUiState>("idle");
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
      ? navigator.onLine
      : true,
  );
  const [multiTabNotice, setMultiTabNotice] = useState<string | null>(null);
  const trRef = useRef(tr);
  trRef.current = tr;
  const publicationIdRef = useRef<string>(getActivePublicationId() || "pub_default");
  const localSaveSeqRef = useRef<number>(0);
  const preserveUnsavedLocalWorkRef = useRef<() => Promise<boolean>>(
    async () => false,
  );

  // Feature Image state (strictly decoupled from Lexical AST / Yjs / restoreKey)
  const [featureImage, setFeatureImage] = useState<ApiMediaAsset | null>(null);
  const [featureImageAlt, setFeatureImageAlt] = useState("");
  const [featureImageCaption, setFeatureImageCaption] = useState("");
  const [showFeatureImagePicker, setShowFeatureImagePicker] = useState(false);
  const [featureImageSaving, setFeatureImageSaving] = useState(false);
  const [featureImageSaveFailed, setFeatureImageSaveFailed] = useState(false);
  const [showUnsplashModal, setShowUnsplashModal] = useState(false);

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

  const [loading, setLoading] = useState(Boolean(postId));
  const [saving, setSaving] = useState(false);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [unsupportedSource, setUnsupportedSource] = useState<unknown | null>(null);
  const [unsupportedMessage, setUnsupportedMessage] = useState<string | null>(null);

  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;

  const collaborationEnabled = useRef(enableCollaboration).current;
  const collabConfig = useMemo<CollaborationConfig | undefined>(() => {
    if (!collaborationEnabled || !postId || typeof window === "undefined") return undefined;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/admin/v1/posts/${postId}/collaboration/ws?publicationId=${encodeURIComponent(publicationIdRef.current)}`;
    return {
      id: `${postId}-k${restoreKey}`,
      user: {
        id: currentUserIdRef.current || "staff",
        name: "Staff Editor",
        color: "#3b82f6",
      },
      providerFactory: (id: string, yjsDocMap: Map<string, YDoc>) => {
        const doc = yjsDocMap.get(id) || new YDoc();
        yjsDocMap.set(id, doc);
        const provider = new WebSocketCollaborationProvider(doc, {
          url: wsUrl,
          docId: id,
          user: {
            id: currentUserIdRef.current || "staff",
            name: "Staff Editor",
            color: "#3b82f6",
          },
        });
        // A remote restore must never destroy uncheckpointed author work.
        const applyIncomingDocument = async (
          loadRemote: () => Promise<{ content: unknown; title: string; version: number }>,
        ): Promise<void> => {
          const generationAtStart = autosaveGenerationsRef.current.currentGeneration;
          const hadUnsavedChangesAtStart = hasUnsavedChangesRef.current;
          const checkpointDurable = await preserveUnsavedLocalWorkRef.current();
          const stillCurrent = () =>
            documentMountedRef.current && activePostIdRef.current === postId;
          const mayReplace = () => canApplyRemoteReplacement({
            hadUnsavedChangesAtStart,
            checkpointDurable,
            generationAtStart,
            generationNow: autosaveGenerationsRef.current.currentGeneration,
            hasUnsavedChangesNow: hasUnsavedChangesRef.current,
          });
          const reportConflict = () => {
            autosaveConflictRef.current = true;
            setAutosaveState("conflict");
            setErrorMsg(trRef.current(
              "Remote changes were received, but local edits could not be saved safely. Keep this tab open and export or copy your draft before reloading.",
            ));
          };
          if (!stillCurrent()) return;
          if (!mayReplace()) {
            reportConflict();
            return;
          }
          try {
            const remote = await loadRemote();
            if (!stillCurrent()) return;
            if (!mayReplace()) {
              reportConflict();
              return;
            }
            const migrated = migrateDocument(remote.content);
            setStudioDoc(migrated);
            latestDocRef.current = migrated;
            setTitle(remote.title);
            latestTitleRef.current = remote.title;
            setVersion(remote.version);
            latestVersionRef.current = remote.version;
            documentEpochRef.current += 1;
            setRestoreKey((k) => k + 1);
            hasUnsavedChangesRef.current = false;
            autosaveConflictRef.current = false;
            setAutosaveState("saved");
            // The old checkpoint remains available in the recovery banner.
            setLocalDurabilityState(checkpointDurable ? "durable" : "idle");
            setErrorMsg(null);
          } catch {
            if (stillCurrent()) reportConflict();
          }
        };
        const loadPost = async () => {
          const result = await apiRequest<{ post: AdminPostDetail }>(`/posts/${postId}`);
          return {
            content: result.post.content ?? result.post.contentJson,
            title: result.post.title || "",
            version: result.post.version || 1,
          };
        };
        provider.on("restore", (payload: unknown) => {
          void applyIncomingDocument(async () => {
            if (payload && typeof payload === "object" && "content" in payload && payload.content) {
              return {
                content: payload.content,
                title: "title" in payload && typeof payload.title === "string"
                  ? payload.title : latestTitleRef.current,
                version: "version" in payload && typeof payload.version === "number"
                  ? payload.version : latestVersionRef.current,
              };
            }
            return loadPost();
          });
        });
        provider.on("epoch-conflict", () => {
          void applyIncomingDocument(loadPost);
        });
        return provider;
      },
    };
  }, [postId, collaborationEnabled, restoreKey]);

  // Coordinated Yjs restoration is enabled; server resets room and syncs active peers via epochs.
  const restoreDisabledReason: string | undefined = undefined;

  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasUnsavedChangesRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const autosaveGenerationsRef = useRef(new EditorialAutosaveGenerations());
  const autosaveConflictRef = useRef(false);
  const restoreInFlightRef = useRef(false);
  const pendingRecoverDraftRef = useRef(false);
  const createdPostRef = useRef<{ id: string; version: number } | null>(null);
  const activePostIdRef = useRef(postId);
  const documentEpochRef = useRef(0);
  const documentMountedRef = useRef(true);
  if (activePostIdRef.current !== postId) {
    activePostIdRef.current = postId;
    documentEpochRef.current += 1;
  }
  const beginDocumentRequest = useCallback((requestedId: string | undefined) => {
    const epoch = documentEpochRef.current;
    return () => documentMountedRef.current && activePostIdRef.current === requestedId &&
      documentEpochRef.current === epoch;
  }, []);
  const latestDocRef = useRef(studioDoc);
  const latestTitleRef = useRef(title);
  const latestSlugRef = useRef(slug);
  const latestExcerptRef = useRef(excerpt);
  const latestMetaTitleRef = useRef(metaTitle);
  const latestMetaDescriptionRef = useRef(metaDescription);
  const latestCanonicalUrlRef = useRef(canonicalUrl);
  const latestTagIdsRef = useRef(selectedTagIds);
  const latestFeaturedRef = useRef(featured);
  const latestFeatureImageRef = useRef(featureImage);
  const latestFeatureImageAltRef = useRef(featureImageAlt);
  const latestFeatureImageCaptionRef = useRef(featureImageCaption);
  // Serialize feature-image PATCHes per post; request completion order must not
  // determine the server's final cover image.
  const featureImageWritesRef = useRef<{ epoch: number; tail: Promise<void> }>({
    epoch: documentEpochRef.current, tail: Promise.resolve(),
  });
  const featureImageEditRef = useRef(0);
  const featureImagePendingRef = useRef(false);
  const featureImageSaveFailedRef = useRef(false);
  const latestVersionRef = useRef(version);

  useEffect(() => { latestDocRef.current = studioDoc; }, [studioDoc]);
  useEffect(() => { latestTitleRef.current = title; }, [title]);
  useEffect(() => { latestSlugRef.current = slug; }, [slug]);
  useEffect(() => { latestExcerptRef.current = excerpt; }, [excerpt]);
  useEffect(() => { latestMetaTitleRef.current = metaTitle; }, [metaTitle]);
  useEffect(() => { latestMetaDescriptionRef.current = metaDescription; }, [metaDescription]);
  useEffect(() => { latestCanonicalUrlRef.current = canonicalUrl; }, [canonicalUrl]);
  useEffect(() => { latestTagIdsRef.current = selectedTagIds; }, [selectedTagIds]);
  useEffect(() => { latestFeaturedRef.current = featured; }, [featured]);
  useEffect(() => { latestFeatureImageRef.current = featureImage; }, [featureImage]);
  useEffect(() => { latestFeatureImageAltRef.current = featureImageAlt; }, [featureImageAlt]);
  useEffect(() => { latestFeatureImageCaptionRef.current = featureImageCaption; }, [featureImageCaption]);
  useEffect(() => {
    // A still-pending PATCH belongs to the previous document epoch. Never
    // inherit its busy/error state when this mounted editor switches posts.
    featureImagePendingRef.current = false;
    featureImageSaveFailedRef.current = false;
    setFeatureImageSaving(false);
    setFeatureImageSaveFailed(false);
  }, [postId]);
  useEffect(() => { latestVersionRef.current = version; }, [version]);

  useEffect(() => {
    documentMountedRef.current = true;
    const warnIfUnsaved = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChangesRef.current && !featureImagePendingRef.current && !featureImageSaveFailedRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnIfUnsaved);
    return () => {
      documentMountedRef.current = false;
      documentEpochRef.current += 1;
      window.removeEventListener("beforeunload", warnIfUnsaved);
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const [showPicker, setShowPicker] = useState(false);
  const [pickerConfig, setPickerConfig] = useState<{
    cardType: string;
    resolve: (payload: Record<string, unknown> | null) => void;
  } | null>(null);
  const [unsplashConfig, setUnsplashConfig] = useState<{
    resolve: (payload: Record<string, unknown> | null) => void;
  } | null>(null);

  const handleRequestMedia = useCallback((req: { cardType: string; source?: string }) => {
    if (req.source === "unsplash") {
      return new Promise<Record<string, unknown> | null>((resolve) => {
        setUnsplashConfig({ resolve });
        setShowUnsplashModal(true);
      });
    }
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
  // Uses the same media upload API as the picker — never persists blob: URLs.
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
    const fetchAllTags = async () => {
      try {
        const res = await apiRequest<{ tags: Tag[] }>("/tags");
        setAllTags(res.tags || []);
      } catch (err) {
        console.error("Failed to load tags", err);
      }
    };
    fetchAllTags();
  }, []);

  useEffect(() => {
    let canceled = false;
    restoreInFlightRef.current = false;
    const ownsDocument = beginDocumentRequest(postId);
    const isCurrent = () => !canceled && ownsDocument();
    autosaveGenerationsRef.current.reset();
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    hasUnsavedChangesRef.current = false;
    createdPostRef.current = null;
    autosaveConflictRef.current = false;
    setAutosaveState("idle"); setSaving(false); setErrorMsg(null);
    setLocalDurabilityState("idle");
    setMultiTabNotice(null);
    setAvailableRecoveryDraft(null);
    setUnsupportedSource(null); setUnsupportedMessage(null);
    if (!postId) {
      setTitle(""); setSlug(""); setExcerpt(""); setMetaTitle(""); setMetaDescription(""); setCanonicalUrl("");
      setStudioDoc(createEmptyStudioDocument()); setVersion(1); latestVersionRef.current = 1;
      setStatus("draft"); setSelectedTagIds([]); setFeatured(false);
      setFeatureImage(null); setFeatureImageAlt(""); setFeatureImageCaption("");
      setScheduledAtStr(""); setRevisions([]); setLoading(false);
      return () => { canceled = true; };
    }
    const fetchPost = async () => {
      setLoading(true);
      try {
        const res = await apiRequest<{ post: AdminPostDetail }>(
          `/posts/${postId}`,
        );
        if (!isCurrent()) return;
        const p = res.post;
        const resolvedPubId = p.publicationId || "pub_default";
        publicationIdRef.current = resolvedPubId;
        setTitle(p.title || "");
        latestTitleRef.current = p.title || "";
        setSlug(p.slug || "");
        latestSlugRef.current = p.slug || "";
        setExcerpt(p.excerpt || "");
        latestExcerptRef.current = p.excerpt || "";
        setMetaTitle(p.metaTitle || "");
        latestMetaTitleRef.current = p.metaTitle || "";
        setMetaDescription(p.metaDescription || "");
        latestMetaDescriptionRef.current = p.metaDescription || "";
        setCanonicalUrl(p.canonicalUrl || "");
        latestCanonicalUrlRef.current = p.canonicalUrl || "";
        setStatus(p.status || "draft");
        setFeatured(p.featured ?? false);
        latestFeaturedRef.current = p.featured ?? false;
        setVersion(p.version || 1);
        latestVersionRef.current = p.version || 1;
        autosaveConflictRef.current = false;
        if (p.featureImage !== undefined) {
          setFeatureImage(p.featureImage || null);
        }
        if (p.featureImageAlt !== undefined) {
          setFeatureImageAlt(p.featureImageAlt || "");
        }
        if (p.featureImageCaption !== undefined) {
          setFeatureImageCaption(p.featureImageCaption || "");
        }
        if (p.scheduledAt) {
          const d = new Date(p.scheduledAt);
          setScheduledAtStr(d.toISOString().slice(0, 16));
        }

        if (p.tags) {
          const tagIds = p.tags.map((t: Tag) => t.id);
          setSelectedTagIds(tagIds);
          latestTagIdsRef.current = tagIds;
        }

        const source = p.content ?? p.contentJson;
        try {
          const migrated = migrateDocument(source);
          assertStudioDocumentEditable(migrated, source);
          setStudioDoc(migrated);
          latestDocRef.current = migrated;
          setUnsupportedSource(null);
          setUnsupportedMessage(null);

          // Check if a newer unsaved recovery draft exists on device (check resolved publicationId and legacy "default")
          const userKey = currentUserIdRef.current || "staff";
          void (async () => {
            try {
              let draft = await indexedDbDraftStore.getDraft(
                resolvedPubId,
                userKey,
                postId,
              );
              if (!draft && resolvedPubId !== "default") {
                draft = await indexedDbDraftStore.getDraft(
                  "default",
                  userKey,
                  postId,
                );
              }
              if (
                !canceled &&
                isCurrent() &&
                draft &&
                (draft.title !== p.title ||
                  JSON.stringify(draft.content) !== JSON.stringify(migrated))
              ) {
                setAvailableRecoveryDraft(draft);
              }
            } catch {
              // Ignore recovery read error
            }
          })();
        } catch (error) {
          if (error instanceof StudioMigrationError) {
            setUnsupportedSource(source);
            setUnsupportedMessage(error.message);
          } else {
            throw error;
          }
        }
      } catch (err) {
        if (!isCurrent()) return;
        if (
          err instanceof ApiError &&
          err.path &&
          Array.isArray(err.path) &&
          err.path.length > 0
        ) {
          setErrorMsg(`${err.path.join(".")}: ${err.message}`);
        } else {
          setErrorMsg(
            err instanceof Error ? err.message : "Failed to load post",
          );
        }
      } finally {
        if (isCurrent()) setLoading(false);
      }
    };

    const fetchRevisions = async () => {
      try {
        const res = await apiRequest<{ revisions: Revision[] }>(
          `/posts/${postId}/revisions`,
        );
        if (isCurrent()) setRevisions(res.revisions || []);
      } catch (err) {
        if (isCurrent()) console.error("Failed to load revisions", err);
      }
    };

    fetchPost();
    fetchRevisions();
    return () => { canceled = true; };
  }, [postId, beginDocumentRequest]);

  useEffect(() => {
    if (!postId) {
      const userKey = currentUserIdRef.current || "staff";
      void (async () => {
        try {
          // Brand-new drafts are only recoverable within the active publication (no cross-publication fallback)
          const draft = await indexedDbDraftStore.getDraft(
            publicationIdRef.current,
            userKey,
            "new",
          );
          if (draft && (draft.title || draft.content)) {
            setAvailableRecoveryDraft(draft);
          }
        } catch {
          // Ignore
        }
      })();
    }
  }, [postId]);

  const clearPersistedDraftsForPost = useCallback(
    (targetPostId: string, syncedSnapshotStartedAt: number = Date.now()) => {
      const userKey = currentUserIdRef.current || "staff";
      const pubKey = publicationIdRef.current;
      // Conditional delete: never destroys a checkpoint written by a sibling tab (P0-4).
      void indexedDbDraftStore.deleteDraftIfSynced(
        pubKey,
        userKey,
        targetPostId,
        syncedSnapshotStartedAt,
      );
      if (pubKey !== "default") {
        void indexedDbDraftStore.deleteDraftIfSynced(
          "default",
          userKey,
          targetPostId,
          syncedSnapshotStartedAt,
        );
      }
    },
    [],
  );

  const buildDraftMetadata = useCallback(
    (): OfflineDraftMetadata => ({
      slug: latestSlugRef.current || undefined,
      excerpt: latestExcerptRef.current || undefined,
      metaTitle: latestMetaTitleRef.current || undefined,
      metaDescription: latestMetaDescriptionRef.current || undefined,
      canonicalUrl: latestCanonicalUrlRef.current || undefined,
      tagIds: latestTagIdsRef.current,
      featured: latestFeaturedRef.current,
    }),
    [],
  );

  const preserveUnsavedLocalWork = useCallback(async (): Promise<boolean> => {
    if (!hasUnsavedChangesRef.current) return false;
    try {
      const res = await indexedDbDraftStore.saveDraft({
        publicationId: publicationIdRef.current,
        userId: currentUserIdRef.current || "staff",
        postId: activePostIdRef.current || createdPostRef.current?.id || "new",
        epoch: documentEpochRef.current,
        baseVersion: latestVersionRef.current,
        content: latestDocRef.current,
        title: latestTitleRef.current,
        updatedAt: Date.now(),
        metadata: buildDraftMetadata(),
      });
      setAvailableRecoveryDraft(res.record);
      setLocalDurabilityState(res.status);
      return res.durable;
    } catch {
      setLocalDurabilityState("failed");
      return false;
    }
  }, [buildDraftMetadata]);
  preserveUnsavedLocalWorkRef.current = preserveUnsavedLocalWork;

  const handleApplyRecoveryDraft = () => {
    if (!availableRecoveryDraft) return;
    const meta = availableRecoveryDraft.metadata;
    if (meta) {
      if (meta.slug !== undefined) { setSlug(meta.slug); latestSlugRef.current = meta.slug; }
      if (meta.excerpt !== undefined) { setExcerpt(meta.excerpt); latestExcerptRef.current = meta.excerpt; }
      if (meta.metaTitle !== undefined) { setMetaTitle(meta.metaTitle); latestMetaTitleRef.current = meta.metaTitle; }
      if (meta.metaDescription !== undefined) { setMetaDescription(meta.metaDescription); latestMetaDescriptionRef.current = meta.metaDescription; }
      if (meta.canonicalUrl !== undefined) { setCanonicalUrl(meta.canonicalUrl); latestCanonicalUrlRef.current = meta.canonicalUrl; }
      if (meta.tagIds !== undefined) { setSelectedTagIds(meta.tagIds); latestTagIdsRef.current = meta.tagIds; }
      if (meta.featured !== undefined) { setFeatured(meta.featured); latestFeaturedRef.current = meta.featured; }
    }
    setLocalDurabilityState(
      availableRecoveryDraft.durability === "durable" ? "durable" : "memory-only",
    );
    if (availableRecoveryDraft.title !== undefined) {
      setTitle(availableRecoveryDraft.title);
      latestTitleRef.current = availableRecoveryDraft.title;
    }
    if (availableRecoveryDraft.content) {
      const migrated = migrateDocument(availableRecoveryDraft.content);
      setStudioDoc(migrated);
      latestDocRef.current = migrated;
    }
    autosaveConflictRef.current = false;
    pendingRecoverDraftRef.current = true;
    setAvailableRecoveryDraft(null);
    hasUnsavedChangesRef.current = true;
    setAutosaveState("idle");

    if (
      postId &&
      (typeof navigator === "undefined" || navigator.onLine !== false)
    ) {
      autosaveGenerationsRef.current.markEdited();
      void performAutosave();
    } else {
      pendingRecoverDraftRef.current = false;
      setRestoreKey((k) => k + 1);
      triggerAutosaveDebounced();
    }
  };

  const handleDiscardRecoveryDraft = async () => {
    if (!availableRecoveryDraft) return;
    await indexedDbDraftStore.deleteDraft(
      availableRecoveryDraft.publicationId,
      availableRecoveryDraft.userId,
      availableRecoveryDraft.postId,
    );
    if (availableRecoveryDraft.publicationId !== "default") {
      await indexedDbDraftStore.deleteDraft(
        "default",
        availableRecoveryDraft.userId,
        availableRecoveryDraft.postId,
      );
    }
    setAvailableRecoveryDraft(null);
  };

  const handleExportRecoveryDraft = () => {
    if (!availableRecoveryDraft) return;
    const jsonStr = JSON.stringify(availableRecoveryDraft, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vibress-recovery-${availableRecoveryDraft.postId}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const performAutosave = useCallback(async () => {
    const isCurrent = beginDocumentRequest(postId);
    if (!isCurrent() || restoreInFlightRef.current) return;
    const savePostId = postId ?? createdPostRef.current?.id;
    if (!savePostId || !hasUnsavedChangesRef.current || autosaveConflictRef.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setIsOnline(false);
      return;
    }

    const currentDoc = latestDocRef.current;
    const currentVersion = latestVersionRef.current;
    const featureSnapshot = {
      featureImageId: latestFeatureImageRef.current?.id ?? null,
      featureImageAlt: latestFeatureImageAltRef.current || null,
      featureImageCaption: latestFeatureImageCaptionRef.current || null,
    };
    const saveTicket = autosaveGenerationsRef.current.beginSave();
    const currentSeq = saveTicket.sequence;

    const stats = extractDocStats(currentDoc);
    logForensicEvent("BEFORE_AUTOSAVE", {
      postId,
      version: currentVersion,
      childCount: stats.childCount,
      wordCount: stats.wordCount,
      hash: stats.hash,
      seq: currentSeq,
    });

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setAutosaveState("saving");
    try {
      const payload = {
        title: latestTitleRef.current,
        slug: latestSlugRef.current || undefined,
        excerpt: latestExcerptRef.current || null,
        metaTitle: latestMetaTitleRef.current || null,
        metaDescription: latestMetaDescriptionRef.current || null,
        canonicalUrl: latestCanonicalUrlRef.current || null,
        content: currentDoc,
        tagIds: latestTagIdsRef.current,
        featured: latestFeaturedRef.current,
        expectedVersion: currentVersion,
      };

      logForensicEvent("AUTOSAVE_PAYLOAD", {
        postId: savePostId,
        version: currentVersion,
        childCount: stats.childCount,
        wordCount: stats.wordCount,
        hash: stats.hash,
        seq: currentSeq,
      });

      const isRecoveringDraft = pendingRecoverDraftRef.current;
      const res = await apiRequest<{ post: AdminPostDetail }>(
        `/posts/${savePostId}${isRecoveringDraft ? "?recoverDraft=1" : ""}`,
        {
          method: "PUT",
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
      );
      if (isRecoveringDraft) {
        pendingRecoverDraftRef.current = false;
        const migratedSaved = migrateDocument(res.post.content ?? res.post.contentJson);
        setStudioDoc(migratedSaved);
        latestDocRef.current = migratedSaved;
        documentEpochRef.current += 1;
        setRestoreKey((k) => k + 1);
      }

      if (!isCurrent()) return;

      // Persist feature-image changes made during the first-create POST.
      // This separate endpoint does not increment the content version.
      // Do not navigate until it acknowledges the same captured generation.
      if (!postId && createdPostRef.current?.id === savePostId) {
        if (res.post.version >= latestVersionRef.current) {
          latestVersionRef.current = res.post.version;
          setVersion(res.post.version);
        }
        await apiRequest(`/posts/${savePostId}/feature-image`, {
          method: "PATCH",
          body: JSON.stringify(featureSnapshot),
          signal: controller.signal,
        });
      }

      if (!isCurrent()) return;

      // Ignore superseded or obsolete responses; never regress the server revision.
      const acknowledgement = autosaveGenerationsRef.current.acknowledge(saveTicket);
      if (!acknowledgement.latestRequest || res.post.version < latestVersionRef.current) {
        return;
      }

      const returnedStats = extractDocStats(res.post.content);
      logForensicEvent("API_RESPONSE", {
        postId: savePostId,
        sentVersion: currentVersion,
        returnedVersion: res.post.version,
        returnedChildCount: returnedStats.childCount,
        returnedWordCount: returnedStats.wordCount,
        returnedHash: returnedStats.hash,
        seq: currentSeq,
      });

      setVersion(res.post.version);
      latestVersionRef.current = res.post.version;
      const userKey = currentUserIdRef.current || "staff";
      indexedDbDraftStore.notifyServerSynced({
        publicationId: publicationIdRef.current,
        userId: userKey,
        postId: savePostId,
        serverVersion: res.post.version,
      });
      if (acknowledgement.latestEdit) {
        hasUnsavedChangesRef.current = false;
        setAutosaveState("saved");
        setLocalDurabilityState("idle");
        setMultiTabNotice(null);
        setErrorMsg(null);
        clearPersistedDraftsForPost(savePostId);
        if (!postId) {
          clearPersistedDraftsForPost("new");
        }
        if (!postId && createdPostRef.current?.id === savePostId) {
          createdPostRef.current = null;
          onNavigate(`/admin/posts/${savePostId}`);
        }
      } else {
        // Another local edit occurred after this immutable request snapshot.
        // Its debounce timer is already pending and must not be invalidated.
        hasUnsavedChangesRef.current = true;
        setAutosaveState("idle");
      }
    } catch (err: unknown) {
      if (pendingRecoverDraftRef.current) {
        pendingRecoverDraftRef.current = false;
        setRestoreKey((k) => k + 1);
      }
      if (!isCurrent()) return;
      if ((err as Error)?.name === "AbortError" ||
          !autosaveGenerationsRef.current.acknowledge(saveTicket).latestRequest) {
        return;
      }
      hasUnsavedChangesRef.current = true;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setIsOnline(false);
        setAutosaveState("idle");
        return;
      }
      if (
        err instanceof ApiError &&
        (err.statusCode === 409 || err.message.includes("Version conflict"))
      ) {
        autosaveConflictRef.current = true;
        setAutosaveState("conflict");
        setErrorMsg(
          "Autosave conflict: Post was modified elsewhere. Please refresh.",
        );
      } else {
        setAutosaveState("failed");
        setErrorMsg(err instanceof Error ? err.message : "Save failed");
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }, [postId, onNavigate, beginDocumentRequest, clearPersistedDraftsForPost]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const handleOnline = () => {
      setIsOnline(true);
      if (
        hasUnsavedChangesRef.current &&
        !autosaveConflictRef.current &&
        !restoreInFlightRef.current
      ) {
        if (autosaveTimerRef.current) {
          clearTimeout(autosaveTimerRef.current);
          autosaveTimerRef.current = null;
        }
        void performAutosave();
        reconnectTimer = setTimeout(() => {
          if (
            documentMountedRef.current &&
            hasUnsavedChangesRef.current &&
            !autosaveConflictRef.current &&
            !restoreInFlightRef.current
          ) {
            void performAutosave();
          }
        }, 1200);
      }
    };
    const handleOffline = () => {
      setIsOnline(false);
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [performAutosave]);

  useEffect(() => {
    const activeTargetId = postId ?? createdPostRef.current?.id ?? "new";
    return indexedDbDraftStore.subscribeToDraftEvents((msg) => {
      if (!documentMountedRef.current) return;
      if (
        msg.publicationId !== publicationIdRef.current ||
        msg.userId !== (currentUserIdRef.current || "staff")
      ) {
        return;
      }
      const currentTargetId = postId ?? createdPostRef.current?.id ?? "new";
      if (msg.postId !== activeTargetId && msg.postId !== currentTargetId) return;

      if (msg.type === "server-synced") {
        if (msg.serverVersion > latestVersionRef.current) {
          if (hasUnsavedChangesRef.current) {
            autosaveConflictRef.current = true;
            setAutosaveState("conflict");
            // Re-persist this tab's in-memory work so "Reload Latest" can never lose it (P0-4).
            void preserveUnsavedLocalWorkRef.current();
            setErrorMsg(
              "Autosave conflict: This post was updated in another browser tab. Your local draft is preserved.",
            );
          } else {
            setVersion(msg.serverVersion);
            latestVersionRef.current = msg.serverVersion;
            setMultiTabNotice(
              `Synced to v${msg.serverVersion} from another open tab.`,
            );
          }
        }
      } else if (msg.type === "draft-saved") {
        setMultiTabNotice(
          "Another open browser tab is actively editing a local draft of this post.",
        );
      }
    });
  }, [postId]);

  const triggerAutosaveDebounced = useCallback(() => {
    autosaveGenerationsRef.current.markEdited();
    hasUnsavedChangesRef.current = true;
    const seq = ++localSaveSeqRef.current;
    setLocalDurabilityState("pending");
    void indexedDbDraftStore
      .saveDraft({
        publicationId: publicationIdRef.current,
        userId: currentUserIdRef.current || "staff",
        postId: postId || "new",
        epoch: documentEpochRef.current,
        baseVersion: latestVersionRef.current,
        content: latestDocRef.current,
        title: latestTitleRef.current,
        updatedAt: Date.now(),
        metadata: buildDraftMetadata(),
      })
      .then((res) => {
        if (!documentMountedRef.current || seq !== localSaveSeqRef.current) return;
        if (!hasUnsavedChangesRef.current) {
          setLocalDurabilityState("idle");
          return;
        }
        setLocalDurabilityState(res.status);
      })
      .catch(() => {
        if (!documentMountedRef.current || seq !== localSaveSeqRef.current) return;
        setLocalDurabilityState("failed");
      });
    setAutosaveState((state) => state === "conflict" ? state : "idle");
    if (autosaveConflictRef.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setIsOnline(false);
      return;
    }
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = setTimeout(() => {
      void performAutosave();
    }, 2000);
  }, [performAutosave, postId]);

  const generateSlug = (text: string) => {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
  };

  const handleTitleChange = (val: string) => {
    setTitle(val);
    latestTitleRef.current = val;
    const generatedSlug = generateSlug(val);
    // Auto-generate slug if it's currently empty or matches the old title's slug
    if (!slug || slug === generateSlug(title)) {
      setSlug(generatedSlug);
      latestSlugRef.current = generatedSlug;
    }
    triggerAutosaveDebounced();
  };

  const handleFeaturedChange = (value: boolean) => {
    setFeatured(value);
    latestFeaturedRef.current = value;
    triggerAutosaveDebounced();
  };

  const handleDocChange = (
    doc: StudioDocument,
    origin: "local" | "remote" = "local",
  ) => {
    if (pendingRecoverDraftRef.current) {
      return;
    }
    const stats = extractDocStats(doc);
    logForensicEvent("PARENT_STATE_UPDATE", {
      childCount: stats.childCount,
      wordCount: stats.wordCount,
      hash: stats.hash,
    });
    setStudioDoc(doc);
    latestDocRef.current = doc;
    // Replayed Yjs changes already belong to the collaborating author.
    // Keep the current snapshot fresh, but avoid redundant competing HTTP PUTs.
    if (origin === "remote") return;
    triggerAutosaveDebounced();
  };


  const handleUpdateFeatureImage = useCallback(
    (
      asset: ApiMediaAsset | null,
      alt?: string | null,
      caption?: string | null,
    ) => {
      // Update the author's UI immediately, but never accept an older reply
      // as proof that the latest selection was persisted.
      setFeatureImage(asset);
      latestFeatureImageRef.current = asset;
      if (alt !== undefined) {
        setFeatureImageAlt(alt || "");
        latestFeatureImageAltRef.current = alt || "";
      }
      if (caption !== undefined) {
        setFeatureImageCaption(caption || "");
        latestFeatureImageCaptionRef.current = caption || "";
      }

      const generation = ++featureImageEditRef.current;
      featureImageSaveFailedRef.current = false;
      setFeatureImageSaveFailed(false);

      if (!postId) {
        autosaveGenerationsRef.current.markEdited();
        hasUnsavedChangesRef.current = true;
        return;
      }

      const isCurrentDocument = beginDocumentRequest(postId);
      const snapshot = {
        featureImageId: latestFeatureImageRef.current?.id ?? null,
        featureImageAlt: latestFeatureImageAltRef.current || null,
        featureImageCaption: latestFeatureImageCaptionRef.current || null,
      };
      if (featureImageWritesRef.current.epoch !== documentEpochRef.current) {
        // Isolate A → B → A document sessions, even when the same post ID
        // returns while an older request is still pending.
        featureImageWritesRef.current = {
          epoch: documentEpochRef.current, tail: Promise.resolve(),
        };
      }
      featureImagePendingRef.current = true;
      setFeatureImageSaving(true);

      const write = async () => {
        if (!isCurrentDocument()) return;
        try {
          const res = await apiRequest<{ post: AdminPostDetail }>(
            `/posts/${postId}/feature-image`,
            { method: "PATCH", body: JSON.stringify(snapshot) },
          );
          if (!isCurrentDocument() || generation !== featureImageEditRef.current) return;
          // Only the latest completed selection may update the visible cover.
          if (res.post.featureImage !== undefined) {
            setFeatureImage(res.post.featureImage);
            latestFeatureImageRef.current = res.post.featureImage;
          }
          featureImageSaveFailedRef.current = false;
          setFeatureImageSaveFailed(false);
          setErrorMsg((current) => current?.startsWith(`${tr("Feature image save failed")}:`) ? null : current);
        } catch (err) {
          if (!isCurrentDocument() || generation !== featureImageEditRef.current) return;
          featureImageSaveFailedRef.current = true;
          setFeatureImageSaveFailed(true);
          setErrorMsg(`${tr("Feature image save failed")}: ${err instanceof Error ? err.message : tr("Network error")}. ${tr("Retry to keep your latest cover.")}`);
        } finally {
          if (isCurrentDocument() && generation === featureImageEditRef.current) {
            featureImagePendingRef.current = false;
            setFeatureImageSaving(false);
          }
        }
      };
      // Sequential writes are essential: ignoring stale responses alone cannot
      // prevent an older PATCH from arriving at the server after the latest one.
      const next = featureImageWritesRef.current.tail.then(write, write);
      featureImageWritesRef.current.tail = next;
    },
    [postId, beginDocumentRequest, tr],
  );

  const handleSelectFeatureImageFromLibrary = (asset: ApiMediaAsset) => {
    handleUpdateFeatureImage(asset, asset.displayName || "", null);
    setShowFeatureImagePicker(false);
  };

  const handleSelectPhotoFromUnsplash = (media: UnsplashSelectResponse["media"]) => {
    if (unsplashConfig) {
      unsplashConfig.resolve({
        assetId: media.id,
        src: media.url,
        alt: media.altText || media.displayName || "",
        caption: media.caption || "",
        width: media.width || undefined,
        height: media.height || undefined,
      });
      setUnsplashConfig(null);
      setShowUnsplashModal(false);
      return;
    }
    handleUpdateFeatureImage(media, media.altText || "", media.caption || "");
    setShowUnsplashModal(false);
  };

  const handleCloseUnsplashModal = () => {
    if (unsplashConfig) {
      unsplashConfig.resolve(null);
      setUnsplashConfig(null);
    }
    setShowUnsplashModal(false);
  };

  const handleRemoveFeatureImage = () => {
    handleUpdateFeatureImage(null, "", "");
  };

  const handleUpdateAltAndCaption = (newAlt: string, newCaption: string) => {
    handleUpdateFeatureImage(featureImage, newAlt, newCaption);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const isCurrent = beginDocumentRequest(postId);
    if (!isCurrent() || restoreInFlightRef.current) return;
    if (autosaveConflictRef.current) return;
    setSaving(true);
    setErrorMsg(null);
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    // Explicit save supersedes pending autosave responses, without authorizing
    // the server to overwrite any newer local draft.
    const saveTicket = autosaveGenerationsRef.current.beginSave();
    const featureSnapshot = {
      featureImageId: latestFeatureImageRef.current?.id ?? null,
      featureImageAlt: latestFeatureImageAltRef.current || null,
      featureImageCaption: latestFeatureImageCaptionRef.current || null,
    };
    abortControllerRef.current?.abort();

    try {
      const payload = {
        title,
        slug: slug || undefined,
        excerpt: excerpt || null,
        metaTitle: metaTitle || null,
        metaDescription: metaDescription || null,
        canonicalUrl: canonicalUrl || null,
        content: studioDoc,
        tagIds: selectedTagIds,
        featured,
        expectedVersion: postId || createdPostRef.current
          ? latestVersionRef.current : undefined,
      };

      const savePostId = postId ?? createdPostRef.current?.id;
      if (savePostId) {
        const res = await apiRequest<{ post: AdminPostDetail }>(
          `/posts/${savePostId}`,
          {
            method: "PUT",
            body: JSON.stringify(payload),
          },
        );
        if (!isCurrent()) return;
        if (!postId && createdPostRef.current?.id === savePostId) {
          if (res.post.version >= latestVersionRef.current) {
            latestVersionRef.current = res.post.version;
            setVersion(res.post.version);
          }
          await apiRequest(`/posts/${savePostId}/feature-image`, {
            method: "PATCH",
            body: JSON.stringify(featureSnapshot),
          });
        }
        if (!isCurrent()) return;
        const acknowledgment = autosaveGenerationsRef.current.acknowledge(saveTicket);
        if (acknowledgment.latestRequest && res.post.version >= latestVersionRef.current) {
          setVersion(res.post.version);
          latestVersionRef.current = res.post.version;
          indexedDbDraftStore.notifyServerSynced({
            publicationId: publicationIdRef.current,
            userId: currentUserIdRef.current || "staff",
            postId: savePostId,
            serverVersion: res.post.version,
          });
          if (acknowledgment.latestEdit) {
            setAutosaveState("saved");
            setLocalDurabilityState("idle");
            setMultiTabNotice(null);
            hasUnsavedChangesRef.current = false;
            clearPersistedDraftsForPost(savePostId);
            if (!postId) {
              clearPersistedDraftsForPost("new");
            }
            if (!postId && createdPostRef.current?.id === savePostId) {
              createdPostRef.current = null;
              onNavigate(`/admin/posts/${savePostId}`);
            }
          } else {
            setAutosaveState("idle");
            hasUnsavedChangesRef.current = true;
            if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
            autosaveTimerRef.current = setTimeout(() => { void performAutosave(); }, 2000);
          }
        }
      } else {
        const res = await apiRequest<{ post: AdminPostDetail }>("/posts", {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            featureImageId: featureImage ? featureImage.id : null,
            featureImageAlt: featureImageAlt || null,
            featureImageCaption: featureImageCaption || null,
            primaryAuthorId: currentUserId,
            authorIds: [currentUserId],
          }),
        });
        if (!isCurrent()) return;
        // A POST can acknowledge snapshot A after the author has typed B.
        const createdId = res.post.id;
        if (!createdId || !Number.isSafeInteger(res.post.version)) {
          throw new Error("The server did not return a recoverable post ID and revision.");
        }
        createdPostRef.current = { id: createdId, version: res.post.version };
        latestVersionRef.current = res.post.version;
        if (autosaveGenerationsRef.current.isCurrent(saveTicket)) {
          hasUnsavedChangesRef.current = false;
          setLocalDurabilityState("idle");
          clearPersistedDraftsForPost("new");
          createdPostRef.current = null;
          onNavigate(`/admin/posts/${createdId}`);
        } else {
          hasUnsavedChangesRef.current = true;
          setAutosaveState("idle");
          setErrorMsg("Post created, but newer edits are not yet saved. Stay in this editor until the latest draft is saved.");
          if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
          autosaveTimerRef.current = setTimeout(() => { void performAutosave(); }, 2000);
        }
      }
    } catch (err) {
      if (!isCurrent()) return;
      if (
        err instanceof ApiError &&
        err.path &&
        Array.isArray(err.path) &&
        err.path.length > 0
      ) {
        setErrorMsg(`${err.path.join(".")}: ${err.message}`);
      } else {
        setErrorMsg(err instanceof Error ? err.message : "Save failed");
      }
    } finally {
      if (isCurrent()) setSaving(false);
    }
  };

  const handlePublish = async () => {
    const isCurrent = beginDocumentRequest(postId);
    if (!postId || !canPublish) return;
    if (featureImageSaveFailedRef.current || autosaveConflictRef.current) {
      setErrorMsg(tr("Finish saving the latest article and cover changes before publishing."));
      return;
    }
    try {
      setSaving(true);
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      if (hasUnsavedChangesRef.current) {
        await performAutosave();
      }
      if (featureImagePendingRef.current) {
        await featureImageWritesRef.current.tail;
      }
      if (!isCurrent()) return;
      if (featureImageSaveFailedRef.current || autosaveConflictRef.current || hasUnsavedChangesRef.current) {
        setErrorMsg(tr("Finish saving the latest article and cover changes before publishing."));
        return;
      }
      await apiRequest(`/posts/${postId}/publish`, { method: "POST" });
      if (isCurrent()) setStatus("published");
    } catch (err) {
      if (!isCurrent()) return;
      setErrorMsg(err instanceof Error ? err.message : "Publish failed");
    } finally {
      if (isCurrent()) setSaving(false);
    }
  };

  const handleUnpublish = async () => {
    const isCurrent = beginDocumentRequest(postId);
    if (!postId || !canPublish) return;
    try {
      await apiRequest(`/posts/${postId}/unpublish`, { method: "POST" });
      if (isCurrent()) setStatus("draft");
    } catch (err) {
      if (!isCurrent()) return;
      setErrorMsg(err instanceof Error ? err.message : "Unpublish failed");
    }
  };

  const handleSchedule = async () => {
    const isCurrent = beginDocumentRequest(postId);
    if (!postId || !canPublish || !scheduledAtStr) return;
    try {
      const scheduledAt = new Date(scheduledAtStr).toISOString();
      await apiRequest(`/posts/${postId}/schedule`, {
        method: "POST",
        body: JSON.stringify({ scheduledAt }),
      });
      if (isCurrent()) setStatus("scheduled");
    } catch (err) {
      if (!isCurrent()) return;
      setErrorMsg(err instanceof Error ? err.message : "Schedule failed");
    }
  };

  const handleRestoreRevision = async (revisionId: string) => {
    const isCurrent = beginDocumentRequest(postId);
    if (!postId || restoreInFlightRef.current) return;
    if (restoreDisabledReason) {
      setErrorMsg(restoreDisabledReason);
      return;
    }
    if (!confirm("Restore this revision? Unsaved changes will be overwritten."))
      return;
    autosaveGenerationsRef.current.reset();
    const restoreGeneration = autosaveGenerationsRef.current.currentGeneration;
    restoreInFlightRef.current = true;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    abortControllerRef.current?.abort();
    try {
      const res = await apiRequest<{ post: AdminPostDetail }>(
        `/posts/${postId}/revisions/${revisionId}/restore`,
        {
          method: "POST",
        },
      );
      if (!isCurrent()) return;
      const p = res.post;
      // Confirmation authorizes the draft at click time only. A later edit
      // belongs to the author and must survive the asynchronous restore.
      if (autosaveGenerationsRef.current.currentGeneration !== restoreGeneration) {
        setVersion(p.version);
        latestVersionRef.current = p.version;
        hasUnsavedChangesRef.current = true;
        setAutosaveState("idle");
        setErrorMsg("Revision restored on the server; your newer draft has been kept and is waiting to save.");
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = setTimeout(() => { void performAutosave(); }, 2000);
        return;
      }
      const migratedRestored = migrateDocument(p.content || p.contentJson);
      setTitle(p.title || "");
      latestTitleRef.current = p.title || "";
      setStudioDoc(migratedRestored);
      latestDocRef.current = migratedRestored;
      setVersion(p.version);
      latestVersionRef.current = p.version;
      documentEpochRef.current += 1;
      setRestoreKey((k) => k + 1);
      hasUnsavedChangesRef.current = false;
      autosaveConflictRef.current = false;
      setLocalDurabilityState("idle");
      setAvailableRecoveryDraft(null);
      clearPersistedDraftsForPost(postId);
      setAutosaveState("saved");
      alert("Revision restored successfully");
    } catch (err) {
      if (!isCurrent()) return;
      setErrorMsg(
        err instanceof Error ? err.message : "Restore revision failed",
      );
      if (hasUnsavedChangesRef.current) {
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = setTimeout(() => { void performAutosave(); }, 2000);
      }
    } finally {
      if (isCurrent()) restoreInFlightRef.current = false;
    }
  };

  const handleWorkflowTransition = async (newStatus: string) => {
    const isCurrent = beginDocumentRequest(postId);
    if (postId) {
      try {
        await transitionPostWorkflow(postId, newStatus);
        if (isCurrent()) setStatus(newStatus);
      } catch (err) {
        if (!isCurrent()) return;
        setErrorMsg(
          err instanceof Error
            ? err.message
            : "Failed to transition workflow status",
        );
      }
    } else {
      setStatus(newStatus);
    }
  };

  const navigateSafely = (path: string) => {
    if ((hasUnsavedChangesRef.current || featureImagePendingRef.current || featureImageSaveFailedRef.current) &&
        !window.confirm(tr("This post has unsaved changes. Leave without saving?"))) return;
    onNavigate(path);
  };

  const renderLocalDurabilityBadge = () => {
    if (availableRecoveryDraft) {
      return (
        <span
          data-testid="recovery-required-badge"
          className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium"
        >
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          {tr("Recovery required")}
        </span>
      );
    }

    if (!hasUnsavedChangesRef.current || autosaveState === "saved") {
      return null;
    }

    switch (localDurabilityState) {
      case "durable":
        return (
          <span
            data-testid="local-durability-status"
            data-durability-mode="durable"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground"
          >
            {!isOnline
              ? tr("Recoverable locally · Offline (pending sync)")
              : tr("Recoverable locally · Pending sync")}
          </span>
        );
      case "memory-only":
        return (
          <span
            data-testid="local-durability-status"
            data-durability-mode="memory-only"
            role="status"
            className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium"
          >
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            {tr("Temporary memory-only protection")}
          </span>
        );
      case "quota-exceeded":
        return (
          <span
            data-testid="local-durability-status"
            data-durability-mode="quota-exceeded"
            role="alert"
            className="inline-flex items-center gap-1 text-xs text-destructive font-medium"
          >
            <AlertCircle className="h-3 w-3" aria-hidden="true" />
            {tr("Persistence unavailable (quota exceeded)")}
          </span>
        );
      case "unavailable":
        return (
          <span
            data-testid="local-durability-status"
            data-durability-mode="unavailable"
            role="alert"
            className="inline-flex items-center gap-1 text-xs text-destructive font-medium"
          >
            <AlertCircle className="h-3 w-3" aria-hidden="true" />
            {tr("Persistence unavailable")}
          </span>
        );
      case "aborted":
      case "failed":
        return (
          <span
            data-testid="local-durability-status"
            data-durability-mode={localDurabilityState}
            role="alert"
            className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium"
          >
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            {tr("Local save failed · Temporary memory-only protection")}
          </span>
        );
      case "pending":
      default:
        return (
          <span
            data-testid="local-durability-status"
            data-durability-mode="pending"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground/80"
          >
            {tr("Unsaved changes")}
          </span>
        );
    }
  };

  const renderAutosaveStatus = () => {
    if (!postId) {
      return (
        <span
          data-testid="editor-save-status"
          aria-live="polite"
          className="inline-flex items-center gap-2"
        >
          <span className="text-xs text-muted-foreground/80 font-normal">
            {tr("New")}
          </span>
          {renderLocalDurabilityBadge()}
        </span>
      );
    }
    let primaryBadge: React.ReactNode;
    switch (autosaveState) {
      case "saving":
        primaryBadge = (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3 animate-spin" aria-hidden="true" /> {tr("Saving...")}
          </span>
        );
        break;
      case "saved":
        primaryBadge = (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/80 font-normal">
            {status === "published" ? `${tr("Published")} · ${tr("Saved")}` : tr("Draft - Saved")}
          </span>
        );
        break;
      case "failed":
        primaryBadge = (
          <span className="inline-flex items-center gap-1.5 text-xs text-destructive font-medium">
            <AlertCircle className="h-3 w-3" aria-hidden="true" /> {tr("Save failed")}
            <button
              type="button"
              data-testid="retry-autosave-btn"
              onClick={() => { void performAutosave(); }}
              className="underline hover:opacity-80 focus:outline-none"
            >
              {tr("Retry")}
            </button>
          </span>
        );
        break;
      case "conflict":
        primaryBadge = (
          <span className="inline-flex items-center gap-1 text-xs text-destructive font-medium">
            <AlertCircle className="h-3 w-3" aria-hidden="true" /> {tr("Version conflict")}
          </span>
        );
        break;
      default:
        primaryBadge = (
          <span className="text-xs text-muted-foreground/80 font-normal">
            {status === "published" ? tr("Published") : tr("Draft")}
          </span>
        );
        break;
    }
    return (
      <span
        data-testid="editor-save-status"
        aria-live="polite"
        className="inline-flex flex-wrap items-center gap-2"
      >
        {primaryBadge}
        {renderLocalDurabilityBadge()}
      </span>
    );
  };

  if (!loading && unsupportedMessage) {
    return (
      <StudioDocumentRecovery message={unsupportedMessage}
        rawDocument={unsupportedSource} resourceLabel="post" />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground gap-2">
        <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span>{tr("Loading article editor...")}</span>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-background">
      {/* Editor Header Bar — Minimalist Ghost-style full-screen toolbar */}
      <header className="flex h-16 items-center justify-between px-6 sm:px-10 md:px-14 shrink-0 bg-background/95 backdrop-blur z-10 border-b border-border/20">
        {/* Left: Back to Posts & Post State */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigateSafely("/admin/posts")}
            className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors group focus:outline-none"
            aria-label={tr("Back to Posts")}
          >
            <ChevronLeft className="h-4 w-4 rtl:rotate-180 transition-transform group-hover:-translate-x-0.5 rtl:group-hover:translate-x-0.5" />
            <span>{tr("Posts")}</span>
          </button>

          <span className="text-muted-foreground/30 font-light select-none">|</span>

          {/* Status badge */}
          {renderAutosaveStatus()}
        </div>

        {/* Right: Actions & Settings Panel Toggle */}
        <div className="flex items-center gap-2">
          {postId && status !== "published" && canPublish ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePublish}
              disabled={autosaveState === "conflict"}
              loading={saving}
              loadingLabel={tr("Publishing...")}
              className="h-8 px-3 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 hover:bg-emerald-500/10 transition"
            >
              {tr("Publish")}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSave}
              disabled={autosaveState === "conflict"}
              loading={saving}
              loadingLabel={tr("Saving...")}
              className="h-8 px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition"
            >
              {status === "published" ? tr("Update") : tr("Save Draft")}
            </Button>
          )}

          {postId && status === "published" && canPublish && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleUnpublish}
              loading={saving}
              className="h-8 px-3 text-xs font-medium text-destructive hover:bg-destructive/10 transition"
            >
              {tr("Unpublish")}
            </Button>
          )}

          {/* Ghost Settings Panel Toggle (◫) */}
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            aria-label={tr("Post settings")}
            title={tr("Post settings")}
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

          {multiTabNotice && (
            <div
              role="status"
              aria-live="polite"
              data-testid="multi-tab-draft-notice"
              className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300 text-xs flex items-center justify-between gap-2"
            >
              <span>{multiTabNotice}</span>
              <button
                type="button"
                onClick={() => setMultiTabNotice(null)}
                className="underline shrink-0"
              >
                {tr("Dismiss")}
              </button>
            </div>
          )}

          {availableRecoveryDraft && (
            <div
              role="alert"
              aria-live="polite"
              data-testid="offline-recovery-banner"
              className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-sm text-foreground"
            >
              <div className="flex items-center gap-3">
                <AlertTriangle className="size-5 text-amber-500 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-amber-600 dark:text-amber-400">
                    {locale?.startsWith("ar") ? "مسودة استرداد محلية متوفرة" : "Local recovery draft available"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {locale?.startsWith("ar")
                      ? `تم العثور على مسودة غير متزامنة محفوظة على هذا الجهاز (${new Date(availableRecoveryDraft.updatedAt).toLocaleTimeString()})`
                      : `Unsynced draft found on this device (${new Date(availableRecoveryDraft.updatedAt).toLocaleTimeString()})`}
                  </p>
                  {postId && availableRecoveryDraft.baseVersion < version && (
                    <p
                      data-testid="recovery-version-conflict"
                      className="mt-1 text-xs font-medium text-destructive"
                    >
                      {locale?.startsWith("ar")
                        ? `تنبيه تعارض النسخ: نسخة الخادم الحالية (v${version}) أحدث من أساس هذه المسودة المحلية (v${availableRecoveryDraft.baseVersion}). راجع قبل الاسترداد أو قم بتصدير النسخة.`
                        : `Version conflict warning: Server version (v${version}) is newer than this offline draft's base (v${availableRecoveryDraft.baseVersion}). Review carefully before recovering or export JSON.`}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleApplyRecoveryDraft}
                  className="h-8 text-xs font-semibold"
                >
                  {locale?.startsWith("ar") ? "استرداد المسودة" : "Recover draft"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDiscardRecoveryDraft}
                  className="h-8 text-xs"
                >
                  {locale?.startsWith("ar") ? "تجاهل والاحتفاظ بالخادم" : "Keep server version"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleExportRecoveryDraft}
                  className="h-8 text-xs text-muted-foreground gap-1"
                  title={locale?.startsWith("ar") ? "تصدير مسودة الاسترداد" : "Export recovery JSON"}
                >
                  <Download className="size-3.5" aria-hidden="true" />
                  {locale?.startsWith("ar") ? "تصدير" : "Export"}
                </Button>
              </div>
            </div>
          )}

          <div>
            {(featureImageSaving || featureImageSaveFailed) && (
              <div role={featureImageSaveFailed ? "alert" : "status"} className="mb-2 text-sm">
                {featureImageSaveFailed ? (
                  <>
                    <span>{tr("Feature image was not saved. Your selection is still visible locally.")}</span>
                    <button
                      type="button"
                      className="ms-2 underline"
                      data-testid="retry-feature-image-save"
                      onClick={() => handleUpdateFeatureImage(
                        latestFeatureImageRef.current,
                        latestFeatureImageAltRef.current,
                        latestFeatureImageCaptionRef.current,
                      )}
                    >
                      {tr("Retry cover save")}
                    </button>
                  </>
                ) : tr("Saving feature image...")}
              </div>
            )}
            <PostFeatureImageControl
              featureImage={featureImage}
              featureImageAlt={featureImageAlt}
              featureImageCaption={featureImageCaption}
              onOpenMediaPicker={() => setShowFeatureImagePicker(true)}
              onOpenUnsplashModal={() => setShowUnsplashModal(true)}
              onRemoveFeatureImage={handleRemoveFeatureImage}
              onUpdateAltAndCaption={handleUpdateAltAndCaption}
            />

            <textarea
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder={tr("Post Title")}
              aria-label={tr("Post Title")}
              className="w-full text-4xl sm:text-5xl font-extrabold bg-transparent border-none outline-none resize-none overflow-hidden focus:ring-0 placeholder:text-muted-foreground/30 leading-tight p-0 text-foreground tracking-tight"
              rows={1}
              onInput={(e) => {
                e.currentTarget.style.height = "auto";
                e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
              }}
            />
          </div>

          <VibressStudio
            key={`${postId || "new"}-${restoreKey}`}
            value={studioDoc}
            metadataRevision={version}
            recoveryLocale={locale}
            revisionId={version}
            replacementId={`${postId || "new"}-${restoreKey}`}
            onChange={handleDocChange}
            placeholder={tr("Begin writing your post...")}
            requestMedia={handleRequestMedia}
            allowUnsplash={true}
            uploadMedia={handleUploadMedia}
            enableAi={aiEnabled}
            onAiGenerate={handleAiGenerate}
            collaboration={collabConfig}
          />
        </div>
      </main>

      <PostSettingsSidebar
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        postTitle={title}
        contentContext={excerpt}
        featured={featured}
        setFeatured={handleFeaturedChange}
        slug={slug}
        setSlug={(next) => { setSlug(next); latestSlugRef.current = next; triggerAutosaveDebounced(); }}
        excerpt={excerpt}
        setExcerpt={(next) => { setExcerpt(next); latestExcerptRef.current = next; triggerAutosaveDebounced(); }}
        metaTitle={metaTitle}
        setMetaTitle={(next) => { setMetaTitle(next); latestMetaTitleRef.current = next; triggerAutosaveDebounced(); }}
        metaDescription={metaDescription}
        setMetaDescription={(next) => { setMetaDescription(next); latestMetaDescriptionRef.current = next; triggerAutosaveDebounced(); }}
        canonicalUrl={canonicalUrl}
        setCanonicalUrl={(next) => { setCanonicalUrl(next); latestCanonicalUrlRef.current = next; triggerAutosaveDebounced(); }}
        allTags={allTags}
        selectedTagIds={selectedTagIds}
        setSelectedTagIds={(next) => { setSelectedTagIds(next); latestTagIdsRef.current = next; triggerAutosaveDebounced(); }}
        scheduledAtStr={scheduledAtStr}
        setScheduledAtStr={setScheduledAtStr}
        handleSchedule={handleSchedule}
        canPublish={canPublish}
        postId={postId || ""}
        revisions={revisions}
        handleRestoreRevision={handleRestoreRevision}
        restoreDisabledReason={restoreDisabledReason}
        onNavigate={navigateSafely}
        status={status}
        onStatusChange={handleWorkflowTransition}
        onUnpublish={handleUnpublish}
        onOpenDiff={() => setShowDiffModal(true)}
        onOpenCollaboration={postId ? () => setShowCollabPanel(true) : undefined}
      />

      {postId && (
        <EditorialCollaborationPanel
          postId={postId}
          isOpen={showCollabPanel}
          onClose={() => setShowCollabPanel(false)}
        />
      )}

      <RevisionDiffModal
        isOpen={showDiffModal}
        onClose={() => setShowDiffModal(false)}
        revisions={revisions}
        currentTitle={title}
        currentContent={studioDoc as unknown as Record<string, unknown>}
        onRestore={handleRestoreRevision}
        restoreDisabledReason={restoreDisabledReason}
      />

      {/* Media Picker Modal Host */}
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

      {/* Feature Image Library Picker */}
      {showFeatureImagePicker && (
        <MediaPicker
          allowedTypes={["image"]}
          onSelectAsset={handleSelectFeatureImageFromLibrary}
          onClose={() => setShowFeatureImagePicker(false)}
        />
      )}

      {/* Unsplash Search & Import Modal */}
      <UnsplashModal
        isOpen={showUnsplashModal}
        onClose={handleCloseUnsplashModal}
        onSelectPhoto={handleSelectPhotoFromUnsplash}
      />
    </div>
  );
};
