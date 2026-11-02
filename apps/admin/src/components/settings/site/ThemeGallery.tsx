import React, { useState } from "react";
import type { ApiThemeSummary } from "../../../lib/api";
import { useAdminLocale } from "../../../lib/admin-locale";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { CheckCircle2, Eye, ImageOff, Search, Settings2, Trash2 } from "lucide-react";

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
    <div className={"relative aspect-[16/10] overflow-hidden border-b border-border bg-muted/20 " + className}>
      {showImage ? (
        <img src={image!} alt={tr("Screenshot of") + " " + theme.manifest.name}
          loading="lazy" decoding="async" onError={() => setFailed(true)}
          className="h-full w-full object-cover object-top" />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-muted/70 via-card to-muted/30 px-6 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-card/80">
            <ImageOff aria-hidden="true" className="size-6 text-muted-foreground/70" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">{tr("Screenshot not available")}</p>
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
      className={"min-w-0 overflow-hidden rounded-2xl border bg-card " + (
        featured
          ? "grid border-primary/30 shadow-sm md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]"
          : "flex flex-col border-border transition-colors hover:border-foreground/30"
      )}>
      <ThemeArtwork theme={theme} className={featured ? "md:aspect-auto md:min-h-[18rem] md:border-b-0 md:border-e" : ""} />
      <div className={"flex min-w-0 flex-1 flex-col gap-3 " + (featured ? "p-5 sm:p-7" : "p-4")}>
        {featured && (
          <Badge variant="secondary" className="w-fit gap-1.5 border border-border bg-muted/50 px-2.5 py-1 text-xs">
            <CheckCircle2 aria-hidden="true" className="size-4 text-emerald-600 dark:text-emerald-400" />
            {tr("Published on your site")}
          </Badge>
        )}
        <div className="min-w-0 space-y-1.5">
          <h4 className={"break-words font-semibold tracking-tight text-foreground " + (featured ? "text-xl" : "text-base")}>
            <bdi>{title}</bdi>
          </h4>
          <p className={(featured ? "text-sm leading-relaxed" : "line-clamp-2 min-h-10 text-sm leading-5") + " text-muted-foreground"}>
            {description}
          </p>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>v{theme.manifest.version}</span><span aria-hidden="true">·</span>
          <span>{theme.isBuiltIn ? tr("Built-in") : tr("Installed ZIP")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          <Button type="button" size="sm" variant="outline" title={tr("Preview theme")}
            aria-label={tr("Preview") + " " + title} onClick={() => onPreview(id)}
            className="min-h-11 flex-1 gap-1.5 text-sm">
            <Eye aria-hidden="true" className="size-4" />{tr("Preview")}
          </Button>
          {!featured && (
            <Button type="button" size="sm" variant="default"
              disabled={busy} onClick={() => onActivate(id)} className="min-h-11 flex-1 text-sm">
              {isPublishing ? tr("Publishing...") : tr("Publish")}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={() => onCustomize(theme)}
            title={tr("Theme settings")} aria-label={tr("Settings") + " " + title}
            className="min-h-11 min-w-11 gap-2 text-sm">
            <Settings2 aria-hidden="true" className="size-4" />{tr("Customize")}
          </Button>
          {!theme.isBuiltIn && !featured && (
            <Button type="button" size="sm" variant="ghost" disabled={busy}
              onClick={() => onDelete(id)} title="Uninstall theme"
              aria-label={tr("Uninstall theme") + " " + title}
              className="min-h-11 min-w-11 text-destructive hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring">
              <Trash2 aria-hidden="true" className="size-4" />
            </Button>
          )}
        </div>
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
  const featured = filter === "all" ? themes.find((theme) => theme.manifest.id === activeThemeId && matches(theme)) : undefined;
  const otherThemes = themes.filter((theme) => theme.manifest.id !== featured?.manifest.id)
    .filter((theme) => (filter === "all" || !theme.isBuiltIn) && matches(theme));
  const busy = Boolean(activating || deleting);
  const cardProps = { busy, onPreview, onActivate, onCustomize, onDelete };

  return (
    <section aria-label={tr("Your themes")} className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
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
      </div>

      {featured && (
        <section aria-label={tr("Currently published theme")} className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {tr("Currently published theme")}
          </h3>
          <ThemeCard theme={featured} featured {...cardProps}
            isPublishing={false} isDeleting={false} />
        </section>
      )}

      {otherThemes.length > 0 && (
        <section aria-label={tr("Other themes")} className="space-y-3">
          {featured && <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{tr("Other themes")}</h3>}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {otherThemes.map((theme) => (
              <ThemeCard key={theme.manifest.id} theme={theme} {...cardProps}
                isPublishing={activating === theme.manifest.id}
                isDeleting={deleting === theme.manifest.id} />
            ))}
          </div>
        </section>
      )}

      {!featured && otherThemes.length === 0 && (
        <div role="status" className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {tr("No matching themes.")}
        </div>
      )}
    </section>
  );
};
