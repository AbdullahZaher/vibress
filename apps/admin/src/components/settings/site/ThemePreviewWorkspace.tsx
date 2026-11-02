import React, { useState } from "react";
import { ArrowLeft, ExternalLink, Laptop, Monitor, RefreshCw, Smartphone } from "lucide-react";
import { useAdminLocale } from "../../../lib/admin-locale";
import { Button } from "../../ui/button";

interface ThemePreviewWorkspaceProps {
  themeName: string;
  url: string;
  onBack: () => void;
  onRefresh: () => void;
}

const VIEWPORTS = [
  { id: "desktop", name: "Desktop", width: 1200, Icon: Monitor },
  { id: "tablet", name: "Tablet", width: 768, Icon: Laptop },
  { id: "mobile", name: "Mobile", width: 390, Icon: Smartphone },
] as const;

/**
 * Publication-scoped preview token is returned by the existing backend.
 * This frame shows SAVED theme settings only; it never publishes a theme.
 * The frame is intentionally script-restricted to prevent untrusted theme
 * embeds from executing active code in the Admin document.
 */
export const ThemePreviewWorkspace: React.FC<ThemePreviewWorkspaceProps> = ({
  themeName, url, onBack, onRefresh,
}) => {
  const { tr } = useAdminLocale();
  const [selected, setSelected] = useState<(typeof VIEWPORTS)[number]["id"]>("desktop");
  const [loaded, setLoaded] = useState(false);
  const viewport = VIEWPORTS.find((item) => item.id === selected) || VIEWPORTS[0];

  return (
    <section aria-label={tr("Theme preview") + " " + themeName} className="mx-auto flex max-w-6xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="outline" size="sm" className="min-h-11 min-w-11"
            aria-label={tr("Back to themes")} onClick={onBack}>
            <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
          </Button>
          <div className="min-w-0">
            <h3 className="break-words text-lg font-semibold">{themeName}</h3>
            <p className="text-sm text-muted-foreground">{tr("Preview only — your published site is unchanged.")}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onRefresh} className="min-h-11 gap-2 text-sm">
          <RefreshCw aria-hidden="true" className="size-4" />{tr("Refresh preview")}
        </Button>
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ExternalLink aria-hidden="true" className="size-4" />
          {tr("Open preview in new tab")}
        </a>
        </div>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 p-3">
        <div role="group" aria-label={tr("Preview device size")} className="flex flex-wrap items-center gap-1">
          {VIEWPORTS.map(({ id, name, Icon }) => (
            <Button key={id} size="sm" variant={selected === id ? "secondary" : "ghost"}
              aria-pressed={selected === id} onClick={() => { setSelected(id); setLoaded(false); }}
              className="min-h-11 gap-2 text-sm">
              <Icon aria-hidden="true" className="size-4" />{tr(name)}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{viewport.width}px · {tr("Saved theme settings")}</p>
      </div>
      <div className="flex min-h-[55dvh] w-full justify-start overflow-x-auto rounded-xl border border-border bg-muted/30 p-2 sm:p-4 2xl:justify-center">
        <div style={{ width: viewport.width, minWidth: viewport.width }}
          className="relative h-[min(65dvh,750px)] min-h-80 shrink-0 overflow-hidden rounded-lg border border-border bg-background shadow-sm">
          {!loaded && (
            <div role="status" className="absolute inset-0 flex items-center justify-center bg-background text-sm text-muted-foreground">
              {tr("Loading preview...")}
            </div>
          )}
          <iframe key={url + ":" + selected} src={url} title={tr("Theme preview") + " " + themeName}
            onLoad={() => setLoaded(true)}
            sandbox="allow-forms allow-popups"
            referrerPolicy="no-referrer"
            className="h-full w-full border-0 bg-background" />
        </div>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {tr("The preview uses saved theme settings. Unsaved edits are not shown. Preview links expire automatically.")}
      </p>
    </section>
  );
};
