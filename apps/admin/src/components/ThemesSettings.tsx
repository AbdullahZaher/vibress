import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  ApiThemeSummary,
  ApiActiveTheme,
  listThemesApi,
  getActiveThemeApi,
  activateThemeApi,
  updateThemeSettingsApi,
  createThemePreviewApi,
  uploadThemeApi,
  deleteThemeApi,
} from "../lib/api";

import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import {
  Palette,
  CheckCircle2,
  Eye,
  Sparkles,
  UploadCloud,
  Trash2,
  Sliders,
  AlertCircle,
  FileArchive,
  Loader2,
  ShieldCheck,
  RefreshCw,
  X,
} from "lucide-react";

export const ThemesSettings: React.FC = () => {
  const [themes, setThemes] = useState<ApiThemeSummary[]>([]);
  const [active, setActive] = useState<ApiActiveTheme | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedThemeForCustomization, setSelectedThemeForCustomization] =
    useState<ApiThemeSummary | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Record<string, unknown>>(
    {},
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Upload modal state
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
    setErrorMsg(null);
    try {
      const [themesRes, activeRes] = await Promise.all([
        listThemesApi(),
        getActiveThemeApi(),
      ]);
      setThemes(themesRes.themes || []);
      const activeTheme: ApiActiveTheme = {
        themeId: activeRes.themeId,
        themeVersion: activeRes.themeVersion,
        settings: activeRes.settings,
        settingsSchemaVersion: activeRes.settingsSchemaVersion,
        isBuiltIn: activeRes.isBuiltIn,
        previewImage: activeRes.previewImage,
      };
      setActive(activeTheme);

      // Find active theme object to default customization
      const activeThemeObj = themesRes.themes?.find(
        (t) => t.manifest.id === activeRes.themeId,
      );
      if (activeThemeObj) {
        setSelectedThemeForCustomization(activeThemeObj);
        setSettingsDraft(activeTheme.settings || {});
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      setErrorMsg(e.message || "Failed to load themes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleActivate = async (id: string) => {
    setActivating(id);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await activateThemeApi(id);
      setActive(res.theme);
      setSettingsDraft(res.theme.settings || {});
      setSuccessMsg(`Theme "${id}" activated successfully.`);
      await load();
    } catch (err: unknown) {
      const e = err as { message?: string };
      setErrorMsg(e.message || "Failed to activate theme");
    } finally {
      setActivating(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(`Are you sure you want to uninstall theme "${id}"?`)) {
      return;
    }
    setDeleting(id);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await deleteThemeApi(id);
      setSuccessMsg(`Theme "${id}" uninstalled.`);
      await load();
    } catch (err: unknown) {
      const e = err as { message?: string };
      setErrorMsg(e.message || "Failed to uninstall theme");
    } finally {
      setDeleting(null);
    }
  };

  const handleSaveSettings = async () => {
    if (!active) return;
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await updateThemeSettingsApi(active.themeId, settingsDraft);
      setActive(res.theme);
      setSettingsDraft(res.theme.settings || {});
      setSuccessMsg("Theme settings saved successfully.");
    } catch (err: unknown) {
      const e = err as { message?: string };
      setErrorMsg(e.message || "Failed to save theme settings");
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async (themeId: string) => {
    try {
      const res = await createThemePreviewApi(themeId);
      window.open(`/?preview=${res.previewToken}`, "_blank");
    } catch (err: unknown) {
      const e = err as { message?: string };
      setErrorMsg(e.message || "Failed to open preview");
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
      const result = await uploadThemeApi(uploadFile);
      setUploadProgress("success");
      setSuccessMsg(`Theme "${result.theme.manifest.name}" installed successfully!`);
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

  if (loading) {
    return (
      <div className="w-full max-w-7xl mx-auto flex items-center justify-center p-12 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="text-xs">Loading theme engine...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 w-full max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Palette className="h-6 w-6 text-primary" /> Themes & Design
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Install, customize, preview, and activate official or external publication themes instantly without restarting.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            className="h-9 gap-1.5 text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setIsUploadOpen(true);
              setUploadFile(null);
              setUploadProgress("idle");
              setUploadError(null);
            }}
            className="h-9 gap-2 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
          >
            <UploadCloud className="h-4 w-4" /> Upload Theme (.zip)
          </Button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium flex items-center gap-2 animate-in fade-in">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-medium flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Installed Themes Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Available Themes ({themes.length})
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {themes.map((t) => {
            const isActive = active?.themeId === t.manifest.id;
            const authorName =
              typeof t.manifest.author === "string"
                ? t.manifest.author
                : t.manifest.author?.name || "Official Vibress";

            return (
              <Card
                key={t.manifest.id}
                className={`overflow-hidden border transition-all duration-200 flex flex-col justify-between ${
                  isActive
                    ? "border-emerald-500/50 bg-emerald-500/5 ring-1 ring-emerald-500/30 shadow-md"
                    : "border-border hover:border-primary/40 hover:shadow-sm"
                }`}
              >
                {/* Theme Card Header / Preview Banner */}
                <div className="relative aspect-16/9 bg-muted/30 border-b border-border flex items-center justify-center overflow-hidden group">
                  {t.previewImage ? (
                    <img
                      src={t.previewImage}
                      alt={t.manifest.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-muted-foreground gap-2 p-6 text-center">
                      <Palette className="h-8 w-8 text-primary/60" />
                      <span className="text-xs font-semibold tracking-wide">
                        {t.manifest.name}
                      </span>
                    </div>
                  )}

                  {/* Status Badges Overlay */}
                  <div className="absolute top-3 left-3 flex items-center gap-1.5">
                    {isActive && (
                      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600 text-[11px] font-semibold gap-1 shadow-sm">
                        <CheckCircle2 className="h-3 w-3" /> Active Theme
                      </Badge>
                    )}
                    {t.isBuiltIn ? (
                      <Badge
                        variant="secondary"
                        className="text-[10px] font-mono bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                      >
                        Built-in
                      </Badge>
                    ) : (
                      <Badge
                        variant="secondary"
                        className="text-[10px] font-mono bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
                      >
                        Liquid Theme
                      </Badge>
                    )}
                  </div>

                  <div className="absolute top-3 right-3">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-background/80 backdrop-blur-xs text-foreground border border-border/60">
                      v{t.manifest.version}
                    </span>
                  </div>
                </div>

                {/* Card Content */}
                <div className="p-5 space-y-3 flex-1 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-sm text-foreground">
                        {t.manifest.name}
                      </h4>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {t.manifest.description || "Custom responsive publication theme."}
                    </p>
                    <p className="text-[11px] text-muted-foreground/80 pt-1">
                      By <span className="font-medium text-foreground">{authorName}</span>
                    </p>
                  </div>

                  {/* Actions Toolbar */}
                  <div className="pt-3 border-t border-border flex items-center gap-2">
                    {isActive ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedThemeForCustomization(t);
                          setSettingsDraft(active.settings || {});
                        }}
                        className="h-8 text-xs flex-1 gap-1.5 bg-background border-border hover:bg-muted font-medium"
                      >
                        <Sliders className="h-3.5 w-3.5 text-primary" /> Customize
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={activating === t.manifest.id}
                        onClick={() => handleActivate(t.manifest.id)}
                        className="h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground flex-1"
                      >
                        {activating === t.manifest.id ? (
                          <span className="flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" /> Activating...
                          </span>
                        ) : (
                          "Activate"
                        )}
                      </Button>
                    )}

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePreview(t.manifest.id)}
                      className="h-8 px-2.5 text-xs border-border bg-card hover:bg-accent text-foreground gap-1"
                      title="Preview theme live"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>

                    {!t.isBuiltIn && !isActive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={deleting === t.manifest.id}
                        onClick={() => handleDelete(t.manifest.id)}
                        className="h-8 px-2 text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10"
                        title="Uninstall theme"
                      >
                        {deleting === t.manifest.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Active Theme Customization Section */}
      {selectedThemeForCustomization && (
        <div className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Theme Customization & Settings
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Configuring variables for <strong>{selectedThemeForCustomization.manifest.name}</strong>
              </p>
            </div>
            <Button
              size="sm"
              disabled={saving}
              onClick={handleSaveSettings}
              className="h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {saving ? "Saving..." : "Save Settings"}
            </Button>
          </div>

          <Card className="p-6 bg-card border-border shadow-xs space-y-6">
            {Object.keys(selectedThemeForCustomization.settingsSchema).length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                This theme does not define custom schema variables in <code>settings.json</code>.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {Object.entries(selectedThemeForCustomization.settingsSchema).map(
                  ([key, schemaDef]) => {
                    const currentVal = settingsDraft[key] ?? schemaDef.default;
                    const fieldType = schemaDef.type || "string";

                    return (
                      <div key={key} className="space-y-1.5">
                        <label className="text-xs font-semibold text-foreground flex items-center justify-between">
                          <span>{schemaDef.label || key.replace(/_/g, " ")}</span>
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {fieldType}
                          </span>
                        </label>

                        {schemaDef.description && (
                          <p className="text-[11px] text-muted-foreground">
                            {schemaDef.description}
                          </p>
                        )}

                        {fieldType === "boolean" ? (
                          <div className="flex items-center gap-2 pt-1">
                            <input
                              type="checkbox"
                              checked={Boolean(currentVal)}
                              onChange={(e) =>
                                setSettingsDraft({
                                  ...settingsDraft,
                                  [key]: e.target.checked,
                                })
                              }
                              className="h-4 w-4 rounded-sm border-border text-primary focus:ring-primary"
                            />
                            <span className="text-xs text-muted-foreground">
                              {Boolean(currentVal) ? "Enabled" : "Disabled"}
                            </span>
                          </div>
                        ) : fieldType === "color" ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={String(currentVal || "#000000")}
                              onChange={(e) =>
                                setSettingsDraft({
                                  ...settingsDraft,
                                  [key]: e.target.value,
                                })
                              }
                              className="h-8 w-10 p-0.5 rounded border border-border bg-transparent cursor-pointer"
                            />
                            <Input
                              value={String(currentVal ?? "")}
                              onChange={(e) =>
                                setSettingsDraft({
                                  ...settingsDraft,
                                  [key]: e.target.value,
                                })
                              }
                              className="h-8 text-xs font-mono bg-card border-border flex-1"
                              placeholder="#6366f1"
                            />
                          </div>
                        ) : fieldType === "select" && Array.isArray(schemaDef.options) ? (
                          <select
                            value={String(currentVal ?? "")}
                            onChange={(e) =>
                              setSettingsDraft({
                                ...settingsDraft,
                                [key]: e.target.value,
                              })
                            }
                            className="w-full h-8 px-2.5 text-xs rounded-md bg-card border border-border text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
                          >
                            {schemaDef.options.map((opt) => {
                              const optVal = typeof opt === "string" ? opt : opt.value;
                              const optLabel = typeof opt === "string" ? opt : opt.label;
                              return (
                                <option key={optVal} value={optVal}>
                                  {optLabel}
                                </option>
                              );
                            })}
                          </select>
                        ) : (
                          <Input
                            type={fieldType === "number" ? "number" : "text"}
                            value={String(currentVal ?? "")}
                            onChange={(e) =>
                              setSettingsDraft({
                                ...settingsDraft,
                                [key]:
                                  fieldType === "number"
                                    ? Number(e.target.value)
                                    : e.target.value,
                              })
                            }
                            className="h-8 text-xs bg-card border-border"
                          />
                        )}
                      </div>
                    );
                  },
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Upload Theme ZIP Modal */}
      {isUploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-card border border-border shadow-2xl rounded-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-border bg-muted/20">
              <div className="flex items-center gap-2">
                <UploadCloud className="h-5 w-5 text-primary" />
                <h3 className="text-base font-bold text-foreground">
                  Upload Theme Package
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsUploadOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              {uploadError && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}

              {uploadProgress === "success" ? (
                <div className="py-8 flex flex-col items-center justify-center gap-3 text-center">
                  <div className="h-12 w-12 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-500">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <h4 className="text-sm font-bold text-foreground">
                    Theme Installed Successfully!
                  </h4>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    Your theme has been validated and added to the themes catalog.
                  </p>
                </div>
              ) : (
                <>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleFileDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                      dragOver
                        ? "border-primary bg-primary/5"
                        : uploadFile
                          ? "border-emerald-500/50 bg-emerald-500/5"
                          : "border-border/80 hover:border-primary/50 hover:bg-muted/10"
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
                      <div className="flex flex-col items-center gap-2">
                        <FileArchive className="h-10 w-10 text-emerald-500" />
                        <span className="text-xs font-semibold text-foreground">
                          {uploadFile.name}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {(uploadFile.size / (1024 * 1024)).toFixed(2)} MB
                        </span>
                        <span className="text-[11px] text-primary underline mt-1">
                          Click to choose a different file
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <UploadCloud className="h-10 w-10 text-muted-foreground/60" />
                        <p className="text-xs font-semibold text-foreground">
                          Drag and drop your theme ZIP file here
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          or click to browse from your computer (max 20MB)
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="p-3.5 rounded-xl bg-muted/30 border border-border/60 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <ShieldCheck className="h-4 w-4 text-primary" /> Theme Package Requirements
                    </div>
                    <ul className="text-[11px] text-muted-foreground space-y-1 list-disc list-inside">
                      <li>Must include valid <code>theme.json</code> manifest (API version 1)</li>
                      <li>Required templates: <code>templates/home.liquid</code>, <code>post.liquid</code>, <code>page.liquid</code></li>
                      <li>No server executables (<code>.ts</code>, <code>.tsx</code>, <code>.sh</code>, <code>.py</code>)</li>
                    </ul>
                  </div>
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-border bg-muted/20 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsUploadOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!uploadFile || uploadProgress === "validating" || uploadProgress === "installing"}
                onClick={handleUploadSubmit}
                className="text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5"
              >
                {uploadProgress === "validating" || uploadProgress === "installing" ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Validating & Installing...
                  </>
                ) : (
                  <>
                    <UploadCloud className="h-3.5 w-3.5" />
                    Install Theme
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
