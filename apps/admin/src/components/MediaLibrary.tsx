import { useAdminLocale } from "../lib/admin-locale";
import React, { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listMediaApi,
  uploadMediaApi,
  updateMediaApi,
  deleteMediaApi,
  getMediaReferencesApi,
  ApiMediaAsset,
  ApiMediaReferenceSummary,
  ApiError,
} from "../lib/api";

import { Button } from "./ui/button";
import { ToggleButton } from "./ui/toggle-button";
import { IconButton } from "./ui/icon-button";
import { AdminPageHeader } from "./common/AdminPageHeader";
import { EditorialPagination } from "./common/EditorialPagination";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Dialog } from "./ui/dialog";
import {
  Video,
  Music,
  FileText,
  Upload,
  Trash2,
  CheckCircle2,
  Copy,
  Search,
} from "lucide-react";

interface MediaLibraryProps {
  canUpload?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
}

export const MediaLibrary: React.FC<MediaLibraryProps> = ({
  canUpload = false,
  canEdit = false,
  canDelete = false,
}) => {
  const { tr } = useAdminLocale();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(24);
  const [sortBy, setSortBy] = useState<"createdAt" | "displayName" | "sizeBytes">("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Detail Modal
  const [selectedAsset, setSelectedAsset] = useState<ApiMediaAsset | null>(
    null,
  );
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // References Query
  const { data: refSummaryData, isLoading: isLoadingRefs, isError: isRefsError } = useQuery<{
    summary: ApiMediaReferenceSummary;
  }>({
    queryKey: ["media-references", selectedAsset?.id],
    queryFn: () => getMediaReferencesApi(selectedAsset!.id),
    enabled: !!selectedAsset,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => { setPage(0); }, [selectedType]);

  const filterType =
    selectedType === "all"
      ? undefined
      : (selectedType as "image" | "video" | "audio" | "file");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["media", { search: debouncedSearch, assetType: filterType, page, pageSize, sortBy, sortOrder }],
    queryFn: () => listMediaApi({
      search: debouncedSearch,
      assetType: filterType,
      limit: pageSize,
      offset: page * pageSize,
      sortBy,
      sortOrder,
    }),
    placeholderData: (previousData) => previousData,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      if (!canUpload) throw new Error(tr("You do not have permission to upload media."));
      return uploadMediaApi(file);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["media"] });
      setUploadError(null);
    },
    onError: (err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      setUploadError(e.message || "Upload failed");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, displayName }: { id: string; displayName: string }) => {
      if (!canEdit) throw new Error(tr("You do not have permission to edit media."));
      return updateMediaApi(id, { displayName });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["media"] });
      setSelectedAsset(res.media);
      setUpdateError(null);
    },
    onError: (err: unknown) => {
      setUpdateError(err instanceof Error ? err.message : "Failed to update media.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => {
      if (!canDelete) throw new Error(tr("You do not have permission to delete media."));
      if (isLoadingRefs || isRefsError) throw new Error(tr("Verify media references before deleting."));
      return deleteMediaApi(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["media"] });
      setSelectedAsset(null);
      setDeleteConfirmOpen(false);
      setDeleteError(null);
    },
    onError: (err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      setDeleteError(e instanceof ApiError && e.code === "MEDIA_IN_USE"
        ? tr("This media is in use and cannot be deleted.")
        : e.message || tr("Delete failed"));
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canUpload) return;
    const files = e.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      uploadMutation.mutate(file);
    });
    e.currentTarget.value = "";
  };

  const handleCopyUrl = (url: string, id: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const openDetail = (asset: ApiMediaAsset) => {
    setDeleteConfirmOpen(false);
    setDeleteError(null);
    setSelectedAsset(asset);
    setDisplayNameDraft(asset.displayName);
  };

  const handleSaveDisplayName = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !selectedAsset) return;
    setUpdateError(null);
    updateMutation.mutate({
      id: selectedAsset.id,
      displayName: displayNameDraft,
    });
  };

  const assets = data?.items || [];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">
      {/* Header */}
      <AdminPageHeader
        title={tr("Media")}
        description={tr("Upload, organize, and manage visual assets across your publication.")}
        actions={canUpload ? (
          <div>
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              onChange={handleFileUpload}
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
              disabled={uploadMutation.isPending}
            />
            <Button
              type="button"
              loading={uploadMutation.isPending}
              loadingLabel={tr("Uploading...")}
              onClick={() => uploadInputRef.current?.click()}
              className="gap-2"
            >
              <Upload className="size-4" aria-hidden="true" />
              {tr("Upload Files")}
            </Button>
          </div>
        ) : undefined}
      />

      {uploadError && (
        <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm font-medium text-destructive">
          {uploadError}
        </div>
      )}

      {updateError && (
        <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm font-medium text-destructive">
          {updateError}
        </div>
      )}

      {/* Filter Toolbar */}
      <section className="vibress-editorial-filterbar space-y-4 pb-4 pt-1" aria-label={tr("Media filters")}>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div role="group" aria-label={tr("Filter by media type")} className="flex min-h-11 max-w-full items-center gap-1 overflow-x-auto">
              {["all", "image", "video", "audio", "file"].map((type) => (
                <ToggleButton
                  key={type}
                  pressed={selectedType === type}
                  onClick={() => setSelectedType(type)}
                >
                  {tr(type === "all" ? "All Media" : type === "image" ? "Images" : type === "video" ? "Videos" : type === "audio" ? "Audio" : "Files")}
                </ToggleButton>
              ))}
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
                <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  type="search"
                  placeholder={tr("Filter assets by filename...")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label={tr("Filter assets by filename...")}
                  className="min-h-11 w-full rounded-lg border-border/80 bg-card ps-9 text-sm"
                />
              </div>
              <label className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
                <span className="shrink-0">{tr("Sort by")}</span>
                <select
                  value={sortBy}
                  onChange={(event) => { setSortBy(event.target.value as typeof sortBy); setPage(0); }}
                  className="min-h-11 min-w-0 rounded-lg border border-border/80 bg-card px-2.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring cursor-pointer sm:w-40"
                  aria-label={tr("Sort by")}
                >
                  <option value="createdAt">{tr("Recently added")}</option>
                  <option value="displayName">{tr("Name")}</option>
                  <option value="sizeBytes">{tr("File size")}</option>
                </select>
              </label>
              <Button type="button" variant="outline" size="sm" className="min-h-10 shrink-0" onClick={() => setSortOrder((order) => order === "desc" ? "asc" : "desc")} aria-label={tr("Toggle sort direction")}>
                {sortOrder === "desc" ? tr("Descending") : tr("Ascending")}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Content Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground" role="status" aria-live="polite">
          <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          {tr("Loading media library...")}
        </div>
      ) : isError ? (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs">
          {tr("Failed to load assets:")} {(error as Error)?.message}
        </div>
      ) : assets.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground space-y-2 border-border/70 shadow-2xs">
          <p className="text-xs font-medium text-foreground">
            {tr("No media assets found")}
          </p>
          <p className="text-xs text-muted-foreground">
            {tr("Upload images, audio, or video files to populate library.")}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-6">
          {assets.map((asset: ApiMediaAsset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => openDetail(asset)}
              aria-label={`${tr("Open asset details")}: ${asset.displayName}`}
              className="group relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-start transition-colors hover:bg-muted/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <div className="aspect-square bg-muted/40 flex items-center justify-center relative overflow-hidden">
                {asset.assetType === "image" ? (
                  <img
                    src={asset.url ?? undefined}
                    alt={asset.displayName}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : asset.assetType === "video" ? (
                  <Video className="h-8 w-8 text-muted-foreground" />
                ) : asset.assetType === "audio" ? (
                  <Music className="h-8 w-8 text-muted-foreground" />
                ) : (
                  <FileText className="h-8 w-8 text-muted-foreground" />
                )}
              </div>
              <div className="p-2 space-y-0.5 border-t border-border">
                <p className="text-xs font-semibold text-foreground truncate">
                  {asset.displayName}
                </p>
                <p className="text-xs text-muted-foreground font-mono">
                  {(asset.sizeBytes / 1024).toFixed(0)} KB
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      <EditorialPagination
        page={page}
        pageSize={pageSize}
        total={data?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
      />

      {/* Asset Detail Modal */}
      <Dialog
        isOpen={!!selectedAsset && !deleteConfirmOpen}
        onClose={() => { setSelectedAsset(null); setDeleteError(null); }}
        title={tr("Asset Preview & Details")}
      >
        {selectedAsset && (
          <div className="space-y-4 pt-2">
            <div className="aspect-video rounded-lg bg-neutral-950 border border-border overflow-hidden flex items-center justify-center">
              {selectedAsset.assetType === "image" ? (
                <img
                  src={selectedAsset.url ?? undefined}
                  alt={selectedAsset.displayName}
                  className="max-h-full object-contain"
                />
              ) : selectedAsset.assetType === "video" ? (
                <video
                  src={selectedAsset.url ?? undefined}
                  controls
                  className="max-h-full"
                />
              ) : selectedAsset.assetType === "audio" ? (
                <audio
                  src={selectedAsset.url ?? undefined}
                  controls
                  className="w-full px-4"
                />
              ) : (
                <div className="text-center space-y-2">
                  <FileText className="h-12 w-12 mx-auto text-muted-foreground" />
                  <p className="text-xs font-mono text-muted-foreground">
                    {selectedAsset.originalFilename}
                  </p>
                </div>
              )}
            </div>

            <form onSubmit={handleSaveDisplayName} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  {tr("Display Name")}
                </label>
                <Input
                  type="text"
                  value={displayNameDraft}
                  onChange={(e) => setDisplayNameDraft(e.target.value)}
                  readOnly={!canEdit}
                  className="h-11 text-sm bg-card border-border"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  {tr("Direct URL")}
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={selectedAsset.url ?? ""}
                    className="h-11 text-sm font-mono bg-muted/40 border-border"
                  />
                  <IconButton
                    label={copiedId === selectedAsset.id ? tr("Copied") : tr("Copy URL")}
                    variant="outline" className="shrink-0"
                    onClick={() => selectedAsset.url && handleCopyUrl(selectedAsset.url, selectedAsset.id)}
                  >
                    {copiedId === selectedAsset.id ? (
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Copy className="h-4 w-4" aria-hidden="true" />
                    )}
                  </IconButton>
                </div>
              </div>

              {/* Usage References */}
              <div className="p-3 rounded-lg border border-border bg-muted/20 space-y-1 text-xs">
                <p className="font-semibold text-foreground">
                  {tr("Usage References")}:
                </p>
                {isLoadingRefs ? (
                  <p className="text-muted-foreground">
                    {tr("Checking references...")}
                  </p>
                ) : isRefsError ? (
                  <p role="alert" className="text-destructive">
                    {tr("Unable to verify media usage. Deletion is disabled until references can be checked.")}
                  </p>
                ) : refSummaryData?.summary ? (
                  <p className="text-muted-foreground font-mono">
                    {tr("Used in")} {refSummaryData.summary.totalReferences} {tr("locations")}
                  </p>
                ) : (
                  <p className="text-muted-foreground font-mono">
                    {tr("No usage recorded")}
                  </p>
                )}
              </div>

              {(canDelete || canEdit) && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  {canDelete && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isLoadingRefs || isRefsError || deleteMutation.isPending}
                      onClick={() => { setDeleteError(null); setDeleteConfirmOpen(true); }}
                      className="min-h-11 gap-1 text-sm text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-4" aria-hidden="true" /> {tr("Delete Asset")}
                    </Button>
                  )}
                  {canEdit && (
                    <Button
                      type="submit"
                      size="sm"
                      className="min-h-11 text-sm font-semibold"
                      loading={updateMutation.isPending}
                      loadingLabel={tr("Saving...")}
                    >
                      {tr("Save Changes")}
                    </Button>
                  )}
                </div>
              )}
            </form>
          </div>
        )}
      </Dialog>

      <Dialog
        isOpen={canDelete && deleteConfirmOpen}
        onClose={() => { if (!deleteMutation.isPending) { setDeleteConfirmOpen(false); setDeleteError(null); } }}
        title={tr("Delete media asset?")}
        description={tr("Deleting a media asset may affect content that uses it. Review usage references before confirming.")}
        className="max-w-md"
      >
        {deleteError && (
          <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {deleteError}
          </div>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={deleteMutation.isPending} onClick={() => { setDeleteConfirmOpen(false); setDeleteError(null); }}>
            {tr("Cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!canDelete || isLoadingRefs || isRefsError || !selectedAsset}
            loading={deleteMutation.isPending}
            loadingLabel={tr("Processing...")}
            onClick={() => { if (selectedAsset) deleteMutation.mutate(selectedAsset.id); }}
          >
            {tr("Confirm delete")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
};
