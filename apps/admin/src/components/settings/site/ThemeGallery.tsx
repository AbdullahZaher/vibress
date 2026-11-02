import React, { useState } from "react";
import type { ApiThemeSummary } from "../../../lib/api";
import { useAdminLocale } from "../../../lib/admin-locale";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { CheckCircle2, Eye, ImageOff, Search, Settings2, Trash2, X } from "lucide-react";

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

export function safeThemePreviewImage(theme: ApiThemeSummary): string | null {
  const src = theme.previewImage || theme.manifest.previewImage;
  if (!src) return null;
  if (src.startsWith("/") && !src.startsWith("//") && !src.includes("\\")) return src;
  if (/^https:\/\/[^\s]+$/i.test(src)) return src;
  return null;
}

interface ArtworkProps { theme: ApiThemeSummary; className?: string }
const ThemeArtwork: React.FC<ArtworkProps> = ({ theme, className = "" }) => {
  const { tr } = useAdminLocale();
  const [failed, setFailed] = useState(false);
  const image = safeThemePreviewImage(theme);
  const showImage = Boolean(image) && !failed;
  return (
    <div className={"relative aspect-[16/10] overflow-hidden border-b border-border/80 bg-muted/20 " + className}>
      {showImage ? (
        <img src={image!} alt={tr("Screenshot of") + " " + theme.manifest.name}
          loading="lazy" decoding="async" onError={() => setFailed(true)}
          className="h-full w-full object-cover object-top transition-transform duration-500 ease-out group-hover:scale-[1.02]" />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-muted/60 via-card to-muted/30 px-6 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl border border-border/80 bg-card/90 shadow-xs">
            <ImageOff aria-hidden="true" className="size-5 text-muted-foreground/70" />
          </div>
          <p className="text-sm font-semibold text-foreground/80">{tr("Screenshot not available")}</p>
          <p className="max-w-60 text-xs leading-relaxed text-muted-foreground">
            {tr("Preview this theme using your actual publication content.")}
          </p>
        </div>
      )}
    </div>
  );
};

interface ThemeCardProps {
  theme: ApiThemeSummary;
  featured?: boolean;
  busy: boolean;
  isPublishing: boolean;
  isDeleting: boolean;
  onPreview: (id: string) => void;
  onActivate: (id: string) => void;
  onCustomize: (theme: ApiThemeSummary) => void;
  onDelete: (id: string) => void;
}

const ThemeCard: React.FC<ThemeCardProps> = ({
  theme, featured = false, busy, isPublishing, isDeleting,
  onPreview, onActivate, onCustomize, onDelete,
}) => {
  const { tr } = useAdminLocale();
  const id = theme.manifest.id;
  const title = tr(theme.manifest.name);
  const description = theme.manifest.description
    ? tr(theme.manifest.description)
    : tr("A responsive publication theme.");
  return (
    <article data-theme-id={id}
      className={"group min-w-0 overflow-hidden rounded-2xl border bg-card transition-all duration-200 " + (
        featured
          ? "grid border-primary/40 shadow-sm md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] hover:border-primary/60"
          : "flex flex-col border-border/80 shadow-xs hover:border-foreground/30 hover:shadow-md"
      )}>
      <ThemeArtwork theme={theme} className={featured ? "md:aspect-auto md:min-h-[19rem] md:border-b-0 md:border-e md:border-e-border/80" : ""} />
      <div className={"flex min-w-0 flex-1 flex-col gap-3.5 " + (featured ? "p-6 sm:p-7 justify-between" : "p-4 sm:p-5")}>
        <div className="min-w-0 space-y-2">
          {featured && (
            <Badge variant="secondary" className="w-fit gap-1.5 border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 aria-hidden="true" className="size-3.5" />
              {tr("Published on your site")}
            </Badge>
          )}
          <h4 className={"break-words font-semibold tracking-tight text-foreground " + (featured ? "text-xl sm:text-2xl" : "text-base")}>
            <bdi>{title}</bdi>
          </h4>
          <p className={(featured ? "text-sm leading-relaxed" : "line-clamp-2 min-h-10 text-sm leading-relaxed") + " text-muted-foreground"}>
            {description}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className="font-mono">v{theme.manifest.version}</span>
          <span aria-hidden="true" className="text-muted-foreground/40">·</span>
          <span className="inline-flex items-center rounded-md border border-border/60 bg-muted/30 px-2 py-0.5">
            {theme.isBuiltIn ? tr("Built-in") : tr("Installed ZIP")}
          </span>
        </div>
        {featured ? (
          <div className="flex flex-wrap items-center gap-2.5 border-t border-border/60 pt-4">
            <Button type="button" size="sm" variant="outline" title={tr("Preview theme")}
              aria-label={tr("Preview") + " " + title} onClick={() => onPreview(id)}
              className="min-h-11 flex-1 gap-2 text-sm font-medium">
              <Eye aria-hidden="true" className="size-4" />{tr("Preview")}
            </Button>
            <Button type="button" size="sm" variant="default" onClick={() => onCustomize(theme)}
              title={tr("Theme settings")} aria-label={tr("Settings") + " " + title}
              className="min-h-11 flex-1 gap-2 text-sm font-semibold shadow-xs">
              <Settings2 aria-hidden="true" className="size-4" />{tr("Customize")}
            </Button>
          </div>
        ) : (
          <div className="mt-auto space-y-2 border-t border-border/60 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" title={tr("Preview theme")}
                aria-label={tr("Preview") + " " + title} onClick={() => onPreview(id)}
                className="min-h-11 flex-1 gap-1.5 text-sm font-medium">
                <Eye aria-hidden="true" className="size-4" />{tr("Preview")}
              </Button>
              <Button type="button" size="sm" variant="default"
                disabled={busy} onClick={() => onActivate(id)} className="min-h-11 flex-1 text-sm font-semibold shadow-xs">
                {isPublishing ? tr("Publishing...") : tr("Publish")}
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-1 pt-0.5">
              <Button type="button" size="sm" variant="ghost" onClick={() => onCustomize(theme)}
                title={tr("Theme settings")} aria-label={tr("Settings") + " " + title}
                className="min-h-10 gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                <Settings2 aria-hidden="true" className="size-3.5" />{tr("Customize")}
              </Button>
              {!theme.isBuiltIn && (
                <Button type="button" size="sm" variant="ghost" disabled={busy || isDeleting}
                  onClick={() => onDelete(id)} title="Uninstall theme"
                  aria-label={tr("Uninstall theme") + " " + title}
                  className="min-h-10 text-xs text-destructive/80 hover:text-destructive hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring">
                  <Trash2 aria-hidden="true" className="size-3.5 me-1" />{tr("Uninstall")}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </article>
  );
};

/** Active theme is visibly separated from the library, rather than one card in a shuffled grid. */
export const ThemeGallery: React.FC<ThemeGalleryProps> = ({
  themes, activeThemeId, activating, deleting, onPreview, onActivate, onCustomize, onDelete,
}) => {
  const { tr } = useAdminLocale();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "installed">("all");
  const search = query.trim().toLocaleLowerCase();
  const matches = (theme: ApiThemeSummary) => (
    (theme.manifest.name + " " + (theme.manifest.description || "")).toLocaleLowerCase().includes(search)
  );
  const featured = themes.find((theme) => theme.manifest.id === activeThemeId && matches(theme) && (filter === "all" || !theme.isBuiltIn));
  const otherThemes = themes.filter((theme) => theme.manifest.id !== featured?.manifest.id)
    .filter((theme) => (filter === "all" || !theme.isBuiltIn) && matches(theme));
  const busy = Boolean(activating || deleting);
  const cardProps = { busy, onPreview, onActivate, onCustomize, onDelete };

  return (
    <section aria-label={tr("Your themes")} className="mx-auto max-w-6xl space-y-8 pb-4">
      <div className="flex flex-col justify-between gap-4 border-b border-border/60 pb-6 sm:flex-row sm:items-end">
        <div className="space-y-1">
          <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">{tr("Your themes")}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {tr("Preview themes with your publication content before publishing.")}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:items-center">
          <label className="relative w-full sm:w-64">
            <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-3.5 size-4 text-muted-foreground" />
            <span className="sr-only">{tr("Search themes")}</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder={tr("Search themes...")} aria-label={tr("Search themes")}
              className="min-h-11 w-full rounded-xl border border-border bg-card pe-8 ps-9 text-sm text-foreground shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label={tr("Clear search")}
                className="absolute end-2 top-2.5 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
                <X aria-hidden="true" className="size-3.5" />
              </button>
            )}
          </label>
          <div role="group" aria-label={tr("Filter themes")} className="flex items-center gap-1.5 self-start sm:self-auto">
            <Button size="sm" variant={filter === "all" ? "secondary" : "outline"}
              aria-pressed={filter === "all"} onClick={() => setFilter("all")} className="min-h-11 text-sm font-medium">{tr("All themes")}</Button>
            <Button size="sm" variant={filter === "installed" ? "secondary" : "outline"}
              aria-pressed={filter === "installed"} onClick={() => setFilter("installed")} className="min-h-11 text-sm font-medium">{tr("Custom themes")}</Button>
          </div>
        </div>
      </div>

      {featured && (
        <section aria-label={tr("Currently published theme")} className="space-y-3.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {tr("Currently published theme")}
            </h3>
          </div>
          <ThemeCard theme={featured} featured {...cardProps}
            isPublishing={false} isDeleting={false} />
        </section>
      )}

      {otherThemes.length > 0 && (
        <section aria-label={tr("Other themes")} className="space-y-3.5 pt-2">
          {featured && (
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {tr("Other themes")}
            </h3>
          )}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {otherThemes.map((theme) => (
              <ThemeCard key={theme.manifest.id} theme={theme} {...cardProps}
                isPublishing={activating === theme.manifest.id}
                isDeleting={deleting === theme.manifest.id} />
            ))}
          </div>
        </section>
      )}

      {!featured && otherThemes.length === 0 && (
        <div role="status" className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/80 bg-muted/10 p-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl border border-border/70 bg-card">
            <Search aria-hidden="true" className="size-5 text-muted-foreground/60" />
          </div>
          <p className="text-base font-semibold text-foreground">{tr("No matching themes found.")}</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            {query ? tr("Try adjusting your search terms or filter.") : tr("No themes are installed in this publication.")}
          </p>
          {query && (
            <Button size="sm" variant="outline" onClick={() => setQuery("")} className="mt-2 min-h-11 text-sm">
              {tr("Clear search")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
};
