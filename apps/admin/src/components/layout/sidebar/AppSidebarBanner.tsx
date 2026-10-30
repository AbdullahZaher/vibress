import React, { useEffect, useId, useState } from "react";
import { Bell, ChevronDown, Sparkles, X } from "lucide-react";
import { useAdminLocale } from "../../../lib/admin-locale";
import { getWhatsNewApi, dismissWhatsNewApi, isSafeWhatsNewUrl, type WhatsNewItem } from "../../../lib/api/whats-new";

interface AppSidebarBannerProps { onNavigate?: (path: string) => void; }

/** Compact, expandable release notice. Details never obscure primary navigation. */
export const AppSidebarBanner: React.FC<AppSidebarBannerProps> = ({ onNavigate }) => {
  const { tr } = useAdminLocale();
  const detailsId = useId();
  const [item, setItem] = useState<WhatsNewItem | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    void getWhatsNewApi().then((response) => {
      if (active) setItem(response.item ?? null);
    }).catch(() => { if (active) setItem(null); });
    return () => { active = false; };
  }, []);

  const dismiss = () => {
    if (!item) return;
    const id = item.id;
    setDismissed(true);
    void dismissWhatsNewApi(id).catch(() => {
      // Keep dismissed locally even when persistence is unavailable.
    });
  };
  const onLink = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!item?.url || !isSafeWhatsNewUrl(item.url)) return;
    if (item.url.startsWith("/") && onNavigate) {
      event.preventDefault();
      onNavigate(item.url);
    }
  };

  if (!item || dismissed) return null;
  const safeUrl = item.url && isSafeWhatsNewUrl(item.url) ? item.url : null;

  return (
    <section data-testid="whats-new-banner" data-notification-id={item.id}
      aria-label={tr("What's new")}
      className="rounded-xl border border-sidebar-border bg-card/70 text-card-foreground">
      <div className="flex items-center gap-1 p-1.5">
        <button type="button" onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded} aria-controls={detailsId}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-start hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            {item.icon === "sparkles" ? <Sparkles className="size-4" aria-hidden="true" /> : <Bell className="size-4" aria-hidden="true" />}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-xs font-semibold text-muted-foreground">{tr("What's new")}</span>
            <span dir="auto" className="truncate text-xs font-medium text-foreground">{item.title}</span>
          </span>
          <ChevronDown aria-hidden="true" className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
        <button type="button" onClick={dismiss} title={tr("Close notification")}
          aria-label={tr("Close notification")}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <div id={detailsId} className="border-t border-border/60 px-3.5 pb-3 pt-2">
          <p dir="auto" className="text-xs leading-relaxed text-muted-foreground">{item.description}</p>
          {safeUrl && (
            <a href={safeUrl} onClick={onLink}
              className="mt-2 inline-flex min-h-9 items-center rounded-md text-xs font-semibold text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring">
              {tr("Learn more")}
            </a>
          )}
        </div>
      )}
    </section>
  );
};
