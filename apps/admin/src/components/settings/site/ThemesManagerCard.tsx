import React, { useState, useCallback, useRef } from "react";
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
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import {
  Palette,
  CheckCircle2,
  Eye,
  RefreshCw,
  X,
  UploadCloud,
  Trash2,
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
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [themes, setThemes] = useState<ApiThemeSummary[]>([]);
  const [active, setActive] = useState<ApiActiveTheme | null>(null);
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Upload modal state inside drawer
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<
    "idle" | "validating" | "installing" | "success" | "error"
  >("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [themesRes, activeRes] = await Promise.all([
        listThemesApi(),
        getActiveThemeApi(),
      ]);
      setThemes(themesRes.themes || []);
      setActive({
        themeId: activeRes.themeId,
        themeVersion: activeRes.themeVersion,
        settings: activeRes.settings,
        settingsSchemaVersion: activeRes.settingsSchemaVersion,
      });
    } catch {
      // Ignored
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpen = () => {
    setIsDrawerOpen(true);
    load();
  };

  const handleActivate = async (id: string) => {
    setActivating(id);
    try {
      const res = await activateThemeApi(id);
      setActive(res.theme);
      await load();
    } catch {
      // Error handled
    } finally {
      setActivating(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(`Are you sure you want to uninstall theme "${id}"?`)) {
      return;
    }
    setDeleting(id);
    try {
      await deleteThemeApi(id);
      await load();
    } catch {
      // Error handled
    } finally {
      setDeleting(null);
    }
  };

  const handlePreview = async (themeId: string) => {
    try {
      const res = await createThemePreviewApi(themeId);
      window.open(`/?preview=${res.previewToken}`, "_blank");
    } catch {
      window.open(`/?preview=${themeId}`, "_blank");
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
        setUploadError("Please select a valid .zip archive file.");
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
        setUploadError("Please select a valid .zip archive file.");
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
        setIsUploadOpen(false);
        setUploadFile(null);
        setUploadProgress("idle");
      }, 1200);
    } catch (err: unknown) {
      setUploadProgress("error");
      const e = err as { message?: string };
      setUploadError(e.message || "Failed to install theme package.");
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
      </SettingsCard>

      {/* Themes Manager Slide-over Drawer */}
      <SettingsModalPortal
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      >
        <div className="fixed inset-0 z-50 flex justify-end bg-background/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-2xl bg-card border-l border-border/80 shadow-2xl h-full flex flex-col justify-between animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="flex items-center justify-between p-5 border-b border-border/60 bg-muted/20">
              <div className="flex items-center gap-2">
                <Palette className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">
                  Themes Manager
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setIsUploadOpen(true);
                    setUploadFile(null);
                    setUploadProgress("idle");
                    setUploadError(null);
                  }}
                  className="gap-1.5 text-xs h-8"
                >
                  <UploadCloud className="h-3.5 w-3.5" /> Upload ZIP
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={load}
                  disabled={loading}
                  className="gap-1.5 text-xs h-8"
                  title="Reload registry themes from backend"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
                  />{" "}
                  Refresh
                </Button>
                <button
                  type="button"
                  aria-label="Close themes drawer"
                  onClick={() => setIsDrawerOpen(false)}
                  className="text-muted-foreground hover:text-foreground p-1 rounded-md cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Drawer Body */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="text-[10px] font-mono border-primary/30 text-primary"
                  >
                    Zero-Rebuild Theme System
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Upload external Liquid theme ZIPs or switch between built-in themes. All changes take effect immediately without recompilation or server restart.
                </p>
              </div>

              {loading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  <RefreshCw className="h-5 w-5 animate-spin text-primary" />
                  <p className="text-xs">Loading theme catalog...</p>
                </div>
              ) : themes.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-xs">
                  No themes discovered.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {themes.map((theme) => {
                    const isCurrent = active?.themeId === theme.manifest.id;
                    return (
                      <div
                        key={theme.manifest.id}
                        className={`rounded-xl border p-4 flex flex-col justify-between transition-all ${
                          isCurrent
                            ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30 shadow-xs"
                            : "border-border/70 hover:border-border hover:bg-muted/10"
                        }`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-bold text-foreground">
                              {theme.manifest.name}
                            </h4>
                            <div className="flex items-center gap-1">
                              <Badge
                                variant="secondary"
                                className="text-[10px] font-mono"
                              >
                                v{theme.manifest.version}
                              </Badge>
                              {!theme.isBuiltIn && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] font-mono text-purple-500 border-purple-500/30"
                                >
                                  ZIP
                                </Badge>
                              )}
                            </div>
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                            {theme.manifest.description ||
                              "Responsive publishing theme optimized for modern publications."}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 pt-4 border-t border-border/40 mt-4">
                          <Button
                            size="sm"
                            disabled={
                              isCurrent || activating === theme.manifest.id
                            }
                            onClick={() => handleActivate(theme.manifest.id)}
                            className="text-xs h-7 flex-1 cursor-pointer"
                            variant={isCurrent ? "outline" : "default"}
                          >
                            {isCurrent ? (
                              <span className="flex items-center gap-1 text-emerald-500 font-medium">
                                <CheckCircle2 className="h-3 w-3" /> Active
                              </span>
                            ) : activating === theme.manifest.id ? (
                              <span className="flex items-center gap-1">
                                <RefreshCw className="h-3 w-3 animate-spin" />{" "}
                                Activating...
                              </span>
                            ) : (
                              "Activate"
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handlePreview(theme.manifest.id)}
                            className="h-7 px-2 text-muted-foreground hover:text-foreground cursor-pointer"
                            title="Preview theme in new tab"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>

                          {!theme.isBuiltIn && !isCurrent && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={deleting === theme.manifest.id}
                              onClick={() => handleDelete(theme.manifest.id)}
                              className="h-7 px-2 text-red-500 hover:text-red-600 hover:bg-red-500/10 cursor-pointer"
                              title="Uninstall theme"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-border/60 bg-muted/20 flex justify-end">
              <Button
                size="sm"
                onClick={() => setIsDrawerOpen(false)}
                className="text-xs cursor-pointer"
              >
                Done
              </Button>
            </div>
          </div>
        </div>

        {/* Inner Upload Modal */}
        {isUploadOpen && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4">
            <div className="w-full max-w-md bg-card border border-border shadow-2xl rounded-2xl overflow-hidden flex flex-col">
              <div className="flex items-center justify-between p-4 border-b border-border bg-muted/20">
                <div className="flex items-center gap-2">
                  <UploadCloud className="h-4 w-4 text-primary" />
                  <h4 className="text-sm font-bold text-foreground">
                    Upload Theme Package
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setIsUploadOpen(false)}
                  className="text-muted-foreground hover:text-foreground p-1 rounded-md"
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
                      Theme Installed Successfully!
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
                    onClick={() => fileInputRef.current?.click()}
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
                      className="hidden"
                    />
                    {uploadFile ? (
                      <div className="flex flex-col items-center gap-1.5">
                        <FileArchive className="h-8 w-8 text-emerald-500" />
                        <span className="text-xs font-semibold">{uploadFile.name}</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1.5">
                        <UploadCloud className="h-8 w-8 text-muted-foreground/60" />
                        <span className="text-xs font-semibold">Drop theme.zip here</span>
                        <span className="text-[10px] text-muted-foreground">or click to browse</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="p-3.5 border-t border-border bg-muted/20 flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsUploadOpen(false)}
                  className="text-xs h-7"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!uploadFile || uploadProgress === "validating" || uploadProgress === "installing"}
                  onClick={handleUploadSubmit}
                  className="text-xs h-7 font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {uploadProgress === "validating" || uploadProgress === "installing" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Install"
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </SettingsModalPortal>
    </>
  );
};
