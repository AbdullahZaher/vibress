import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  ApiThemeSummary,
  ApiActiveTheme,
  listThemesApi,
  getActiveThemeApi,
  activateThemeApi,
  createThemePreviewApi,
  uploadThemeApi,
  deleteThemeApi,
} from "../../../lib/api";
import { SettingsCard } from "../SettingsCard";
import { SettingsCardRow } from "../SettingsCardRow";
import { SettingsModalPortal } from "../SettingsModalPortal";
import { useSettingsConfirmation } from "../hooks/useSettingsConfirmation";
import { ThemeSettingsEditor } from "./ThemeSettingsEditor";
import { ThemeGallery } from "./ThemeGallery";
import { useAdminLocale } from "../../../lib/admin-locale";
import { Button } from "../../ui/button";
import {
  Palette,
  CheckCircle2,
  RefreshCw,
  X,
  UploadCloud,
  FileArchive,
  Loader2,
  AlertCircle,
} from "lucide-react";

interface ThemesManagerCardProps {
  isHighlighted?: boolean | undefined;
}

export const ThemesManagerCard: React.FC<ThemesManagerCardProps> = ({
  isHighlighted,
}) => {
  const { tr } = useAdminLocale();
  const { confirm, confirmationDialog, isConfirmOpen } = useSettingsConfirmation();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [themes, setThemes] = useState<ApiThemeSummary[]>([]);
  const [active, setActive] = useState<ApiActiveTheme | null>(null);
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editingTheme, setEditingTheme] = useState<ApiThemeSummary | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewFallbackUrl, setPreviewFallbackUrl] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const drawerRef = useRef<HTMLDivElement>(null);
  const uploadDialogRef = useRef<HTMLDivElement>(null);
  const openingControlRef = useRef<HTMLElement | null>(null);
  const uploadControlRef = useRef<HTMLButtonElement>(null);

  // Upload modal state inside drawer
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<
    "idle" | "validating" | "installing" | "success" | "error"
  >("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isDrawerOpen) return;
    drawerRef.current?.querySelector<HTMLButtonElement>('[aria-label="Close themes drawer"]')?.focus();
    return () => {
      openingControlRef.current?.focus();
    };
  }, [isDrawerOpen]);

  useEffect(() => {
    if (!isDrawerOpen) return;
    if (isConfirmOpen) return;
    const focusRoot = isUploadOpen ? uploadDialogRef.current : drawerRef.current;
    if (isUploadOpen) {
      focusRoot?.querySelector<HTMLButtonElement>('[aria-label="Close theme upload"]')?.focus();
    }
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !focusRoot) return;
      const controls = Array.from(
        focusRoot.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.classList.contains("hidden"));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (!focusRoot.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trapTab);
    return () => document.removeEventListener("keydown", trapTab);
  }, [isDrawerOpen, isUploadOpen, isConfirmOpen]);



  const load = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setCatalogError(null);
    try {
      const [themesRes, activeRes] = await Promise.all([listThemesApi(), getActiveThemeApi()]);
      if (requestId !== requestSequence.current) return;
      setThemes(themesRes.themes || []);
      setActive({
        themeId: activeRes.themeId,
        themeVersion: activeRes.themeVersion,
        settings: activeRes.settings,
        settingsSchemaVersion: activeRes.settingsSchemaVersion,
      });
    } catch (error: unknown) {
      if (requestId !== requestSequence.current) return;
      setCatalogError(error instanceof Error ? error.message : "Failed to load themes.");
      setThemes([]);
      setActive(null);
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onPublicationChange = () => {
      requestSequence.current += 1;
      setActive(null);
      setThemes([]);
      setActionError(null);
      setActionSuccess(null);
      setIsDrawerOpen(false);
      setEditingTheme(null);
      void load();
    };
    window.addEventListener("vibress:publication-changed", onPublicationChange);
    return () => {
      requestSequence.current += 1;
      window.removeEventListener("vibress:publication-changed", onPublicationChange);
    };
  }, [load]);

  const handleEditorBack = async () => {
    if (editorSaving) return;
    if (editorDirty && !(await confirm(tr("Discard unsaved theme settings changes?"), { destructive: true }))) return;
    setEditingTheme(null);
    setEditorDirty(false);
  };

  const handleCloseDrawer = async () => {
    if (editorSaving) return;
    if (editorDirty && !(await confirm(tr("Discard unsaved theme settings changes?"), { destructive: true }))) return;
    setEditingTheme(null);
    setEditorDirty(false);
    setIsDrawerOpen(false);
  };

  const handleCloseUpload = () => {
    setIsUploadOpen(false);
    uploadControlRef.current?.focus();
  };

  const handleOpen = () => {
    openingControlRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIsDrawerOpen(true);
    setActionError(null);
    setActionSuccess(null);
    void load();
  };

  const handleActivate = async (id: string) => {
    const selected = themes.find((theme) => theme.manifest.id === id);
    if (!selected || active?.themeId === id || activating || deleting) return;
    if (!(await confirm(
      tr("Publish this theme to your live website?") + " " + selected.manifest.name,
      { confirmLabel: tr("Publish theme") },
    ))) return;
    setActivating(id);
    setActionError(null);
    setActionSuccess(null);
    try {
      const result = await activateThemeApi(id);
      setActive(result.theme);
      setActionSuccess(tr("Theme published successfully."));
      await load();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : tr("Failed to publish theme."));
    } finally {
      setActivating(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm(tr("Uninstall this theme?") + " " + id, { destructive: true, confirmLabel: tr("Uninstall theme") }))) {
      return;
    }
    setDeleting(id);
    setActionError(null);
    setActionSuccess(null);
    try {
      await deleteThemeApi(id);
      setActionSuccess(tr("Theme uninstalled."));
      await load();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : tr("Failed to uninstall theme."));
    } finally {
      setDeleting(null);
    }
  };

  const handlePreview = async (themeId: string) => {
    setPreviewError(null);
    setPreviewFallbackUrl(null);
    try {
      const res = await createThemePreviewApi(themeId);
      const url = "/preview/" + encodeURIComponent(res.previewToken);
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) setPreviewFallbackUrl(url);
    } catch (error: unknown) {
      setPreviewError(error instanceof Error ? error.message : tr("Failed to open theme preview."));
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith(".zip")) {
        setUploadFile(file);
        setUploadError(null);
      } else {
        setUploadError(tr("Please select a valid .zip archive file."));
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.name.endsWith(".zip")) {
        setUploadFile(file);
        setUploadError(null);
      } else {
        setUploadError(tr("Please select a valid .zip archive file."));
      }
    }
  };

  const handleUploadSubmit = async () => {
    if (!uploadFile) return;
    setUploadProgress("validating");
    setUploadError(null);

    try {
      setUploadProgress("installing");
      await uploadThemeApi(uploadFile);
      setUploadProgress("success");
      await load();
      setTimeout(() => {
        handleCloseUpload();
        setUploadFile(null);
        setUploadProgress("idle");
      }, 1200);
    } catch (err: unknown) {
      setUploadProgress("error");
      const e = err as { message?: string };
      setUploadError(e.message || tr("Failed to install theme package."));
    }
  };

  return (
    <>
      <SettingsCard id="site-themes" isHighlighted={isHighlighted}>
        <SettingsCardRow
          icon={<Palette className="h-4 w-4" />}
          title="Themes"
          description="Choose how your publication looks and feels with official and custom responsive themes."
          currentValue={
            <Badge variant="secondary" className="text-xs font-mono gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              {active ? active.themeId : "Vibress Default"} (Active)
            </Badge>
          }
          actionLabel="Change theme"
          onAction={handleOpen}
        />
        <div role="status" className="flex flex-wrap items-center gap-2 border-t border-border/50 px-4 py-3 text-sm sm:px-5">
          <span className="text-muted-foreground">{tr("Published theme")}:</span>
          {loading && !active ? (
            <span className="text-muted-foreground">{tr("Loading themes...")}</span>
          ) : catalogError ? (
            <>
              <span className="text-destructive">{tr("Unable to load published theme.")}</span>
              <Button size="sm" variant="outline" onClick={() => void load()}>{tr("Retry")}</Button>
            </>
          ) : active ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-foreground">
              <CheckCircle2 aria-hidden="true" className="size-4 text-emerald-600 dark:text-emerald-400" />
              <bdi>{themes.find((theme) => theme.manifest.id === active.themeId)?.manifest.name || active.themeId}</bdi>
              <span className="font-normal text-muted-foreground">v{active.themeVersion}</span>
            </span>
          ) : <span className="text-muted-foreground">{tr("No active theme found.")}</span>}
        </div>
      </SettingsCard>

      {/* Themes Manager Slide-over Drawer */}
      <SettingsModalPortal
        title="Themes manager"
        manageFocus={false}
        isOpen={isDrawerOpen}
        onClose={isUploadOpen ? handleCloseUpload : handleCloseDrawer}
      >
        <div ref={drawerRef} role="dialog" aria-modal="true" aria-label={tr("Themes Manager")} className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-7xl bg-card border border-border/80 shadow-2xl h-full sm:h-[min(94dvh,1100px)] sm:rounded-2xl overflow-hidden flex flex-col justify-between animate-in fade-in duration-200">
            {/* Drawer Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-border/60 bg-muted/20">
              <div className="flex flex-wrap items-center gap-2">
                <Palette className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">
                  {tr("Theme Studio")}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  ref={uploadControlRef}
                  disabled={editingTheme !== null}
                  onClick={() => {
                    setIsUploadOpen(true);
                    setUploadFile(null);
                    setUploadProgress("idle");
                    setUploadError(null);
                  }}
                  className="gap-1.5 text-sm min-h-10"
                >
                  <UploadCloud className="h-3.5 w-3.5" /> {tr("Upload ZIP")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={load}
                  disabled={loading || editingTheme !== null}
                  className="gap-1.5 text-sm min-h-10"
                  title="Reload registry themes from backend"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
                  />{" "}
                  {tr("Refresh")}
                </Button>
                <button
                  type="button"
                  aria-label="Close themes drawer"
                  onClick={handleCloseDrawer}
                  disabled={editorSaving}
                  className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Drawer Body */}
            <div className="min-h-0 p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
              {previewError && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{previewError}</p>}
              {actionError && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{actionError}</p>}
              {actionSuccess && <p role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-foreground">{actionSuccess}</p>}
              {previewFallbackUrl && <p role="status" className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
                {tr("Your browser blocked the preview tab.")}{" "}
                <a href={previewFallbackUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline underline-offset-4">{tr("Open preview")}</a>
              </p>
              {editingTheme ? (
                <ThemeSettingsEditor
                  key={editingTheme.manifest.id}
                  theme={editingTheme}
                  onBack={handleEditorBack}
                  onDirtyChange={setEditorDirty}
                  onSavingChange={setEditorSaving}
                  onSaved={(settings) => {
                    setActive((current) => current && current.themeId === editingTheme.manifest.id
                      ? { ...current, settings }
                      : current);
                  }}
                />
              ) : loading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  <RefreshCw className="h-5 w-5 animate-spin text-primary" />
                  <p className="text-sm">{tr("Loading theme catalog...")}</p>
                </div>
              ) : catalogError ? (
                <div role="alert" className="rounded-xl border border-destructive/20 p-6 text-sm">
                  <p className="font-semibold">{tr("Failed to load themes.")}</p>
                  <p className="my-3 text-muted-foreground">{catalogError}</p>
                  <Button size="sm" variant="outline" onClick={() => void load()}>{tr("Retry")}</Button>
                </div>
              ) : themes.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  {tr("No themes discovered.")}
                </div>
              ) : (
                <ThemeGallery
                  themes={themes}
                  activeThemeId={active?.themeId}
                  activating={activating}
                  deleting={deleting}
                  onPreview={(id) => void handlePreview(id)}
                  onActivate={(id) => void handleActivate(id)}
                  onCustomize={(theme) => { setEditorDirty(false); setEditingTheme(theme); }}
                  onDelete={(id) => void handleDelete(id)}
                />
              )}
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-border/60 bg-muted/20 flex justify-end">
              <Button
                size="sm"
                onClick={editingTheme ? handleEditorBack : handleCloseDrawer}
                disabled={editorSaving}
                className="min-h-11 text-sm"
              >
                {editingTheme ? tr("Back to themes") : tr("Close manager")}
              </Button>
            </div>
          </div>
        </div>

        {/* Inner Upload Modal */}
        {isUploadOpen && (
          <div ref={uploadDialogRef} role="dialog" aria-modal="true" aria-label={tr("Upload Theme Package")} className="fixed inset-0 z-60 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4">
            <div className="w-full max-w-md bg-card border border-border shadow-2xl rounded-2xl overflow-hidden flex flex-col">
              <div className="flex items-center justify-between p-4 border-b border-border bg-muted/20">
                <div className="flex items-center gap-2">
                  <UploadCloud className="h-4 w-4 text-primary" />
                  <h4 className="text-sm font-bold text-foreground">
                    {tr("Upload Theme Package")}
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={handleCloseUpload}
                  aria-label="Close theme upload"
                  className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-5 space-y-3">
                {uploadError && (
                  <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{uploadError}</span>
                  </div>
                )}

                {uploadProgress === "success" ? (
                  <div className="py-6 flex flex-col items-center justify-center gap-2 text-center">
                    <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                    <p className="text-xs font-bold text-foreground">
                      {tr("Theme Installed Successfully!")}
                    </p>
                  </div>
                ) : (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleFileDrop}
                    onClick={(event) => { if (event.target !== fileInputRef.current) fileInputRef.current?.click(); }}
                    onKeyDown={(event) => {
                      if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-describedby="theme-zip-help"
                    aria-label={tr("Upload Theme Package")}
                    className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer ${
                      dragOver
                        ? "border-primary bg-primary/5"
                        : uploadFile
                          ? "border-emerald-500/50 bg-emerald-500/5"
                          : "border-border hover:border-primary/50"
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".zip"
                      onChange={handleFileSelect}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={tr("Choose ZIP file")}
                      className="sr-only"
                    />
                    {uploadFile ? (
                      <div className="flex flex-col items-center gap-1.5">
                        <FileArchive className="h-8 w-8 text-emerald-500" />
                        <span className="text-xs font-semibold">{uploadFile.name}</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1.5">
                        <UploadCloud className="h-8 w-8 text-muted-foreground/60" />
                        <span className="text-sm font-semibold">{tr("Drop theme.zip here")}</span>
                        <span id="theme-zip-help" className="text-sm text-muted-foreground">{tr("or click to browse")}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="p-3.5 border-t border-border bg-muted/20 flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCloseUpload}
                  className="min-h-11 text-sm"
                >
                  {tr("Cancel")}
                </Button>
                <Button
                  size="sm"
                  disabled={!uploadFile || uploadProgress === "validating" || uploadProgress === "installing"}
                  onClick={handleUploadSubmit}
                  className="text-sm min-h-10 font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {uploadProgress === "validating" || uploadProgress === "installing" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    tr("Install")
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </SettingsModalPortal>
      {confirmationDialog}
    </>
  );
};
