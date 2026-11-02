import React, { useState } from "react";
import type { ApiThemeSummary } from "../../../lib/api";
import { useAdminLocale } from "../../../lib/admin-locale";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { CheckCircle2, Eye, ImageOff, Palette, Search, Settings2, Trash2 } from "lucide-react";

interface ThemeGalleryProps {
  themes: ApiThemeSummary[];
  activeThemeId?: string | undefined;
  activating: string | null;
  deleting: string | null;
  onPreview: (id: string) => void;
  onActivate: (id: string) => void;
  onCustomize: (theme: ApiThemeSummary) => void;
  onDelete: (id: string) => void;
}

/** The gallery shows actual provided artwork only; missing screenshots have an honest fallback. */
export function safeThemePreviewImage(theme: ApiThemeSummary): string | null {
  const src = theme.previewImage || theme.manifest.previewImage;
  if (!src) return null;
  if (src.startsWith("/") && !src.startsWith("//")) return src;
  if (/^https:\/\//i.test(src)) return src;
  return null;
}

export const ThemeGallery: React.FC<ThemeGalleryProps> = ({
  themes, activeThemeId, activating, deleting, onPreview, onActivate, onCustomize, onDelete,
}) => {
  const { tr } = useAdminLocale();
  const [query, setQuery] = useState("");
  const [brokenImages, setBrokenImages] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<"all" | "installed">("all");
  const visible = themes
    .filter((theme) => filter === "all" || !theme.isBuiltIn)
    .filter((theme) => (theme.manifest.name + " " + (theme.manifest.description || "")).toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => Number(b.manifest.id === activeThemeId) - Number(a.manifest.id === activeThemeId));

  return (
    <section aria-label={tr("Your themes")} className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="space-y-1">
          <h3 className="text-xl font-semibold tracking-tight text-foreground">{tr("Your themes")}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {tr("Preview themes with your publication content before publishing.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
            <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-3.5 size-4 text-muted-foreground" />
            <span className="sr-only">{tr("Search themes")}</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder={tr("Search themes")} aria-label={tr("Search themes")}
              className="min-h-11 w-full rounded-lg border border-border bg-card pe-3 ps-9 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
          <Button size="sm" variant={filter === "all" ? "secondary" : "outline"}
            aria-pressed={filter === "all"} onClick={() => setFilter("all")} className="min-h-11 text-sm">{tr("All themes")}</Button>
          <Button size="sm" variant={filter === "installed" ? "secondary" : "outline"}
            aria-pressed={filter === "installed"} onClick={() => setFilter("installed")} className="min-h-11 text-sm">{tr("Custom themes")}</Button>
        </div>
      </header>

      {visible.length === 0 ? (
        <div role="status" className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {tr("No matching themes.")}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((theme) => {
            const isCurrent = activeThemeId === theme.manifest.id;
            const img = safeThemePreviewImage(theme);
            return (
              <article key={theme.manifest.id}
                className={"group flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card transition-colors " +
                (isCurrent ? "border-primary/60 ring-1 ring-primary/20" : "border-border hover:border-foreground/30")}>
                <div className="relative aspect-[16/10] overflow-hidden border-b border-border bg-muted/20">
                  {img && !brokenImages.has(theme.manifest.id) ? (
                    <img src={img} loading="lazy" alt={tr("Screenshot of") + " " + theme.manifest.name}
                      onError={() => setBrokenImages((previous) => new Set(previous).add(theme.manifest.id))}
                      className="h-full w-full object-cover object-top" />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
                      <ImageOff aria-hidden="true" className="size-8 opacity-40" />
                      <span className="text-sm">{tr("Screenshot not available")}</span>
                    </div>
                  )}
                  {isCurrent && (
                    <Badge variant="secondary" className="absolute start-3 top-3 gap-1 border border-border bg-card text-xs shadow-sm">
                      <CheckCircle2 aria-hidden="true" className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                      {tr("Published")}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div className="space-y-1">
                    <h4 className="break-words text-base font-semibold text-foreground">{theme.manifest.name}</h4>
                    <p className="line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">
                      {theme.manifest.description || tr("A responsive publication theme.")}
                    </p>
                  </div>
                  <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>v{theme.manifest.version}</span><span aria-hidden="true">·</span>
                    <span>{theme.isBuiltIn ? tr("Built-in") : tr("Installed ZIP")}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                    <Button size="sm" variant="outline" title="Preview theme in new tab"
                      aria-label={tr("Preview") + " " + theme.manifest.name} onClick={() => onPreview(theme.manifest.id)}
                      className="min-h-11 flex-1 gap-1.5 text-sm">
                      <Eye aria-hidden="true" className="size-4" />{tr("Preview")}
                    </Button>
                    <Button size="sm" variant={isCurrent ? "outline" : "default"}
                      disabled={isCurrent || Boolean(activating) || Boolean(deleting)}
                      onClick={() => onActivate(theme.manifest.id)}
                      className="min-h-11 flex-1 text-sm">
                      {isCurrent ? tr("Published") : activating === theme.manifest.id ? tr("Publishing...") : tr("Publish")}
                    </Button>
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => onCustomize(theme)}
                      title={tr("Theme settings")} aria-label={tr("Settings") + " " + theme.manifest.name}
                      className="min-h-11 min-w-11 gap-2 text-sm">
                      <Settings2 aria-hidden="true" className="size-4" />{tr("Customize")}
                    </Button>
                    {!theme.isBuiltIn && !isCurrent && (
                      <Button size="sm" variant="ghost" disabled={deleting === theme.manifest.id}
                        onClick={() => onDelete(theme.manifest.id)}
                        title="Uninstall theme" aria-label={tr("Uninstall theme") + " " + theme.manifest.name}
                        className="min-h-11 min-w-11 text-destructive hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring">
                        <Trash2 aria-hidden="true" className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
