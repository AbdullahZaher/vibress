import { Puzzle } from "lucide-react";
import type { AdminExtensionViewLink } from "../../../lib/api";
import { useAdminLocale } from "../../../lib/admin-locale";

interface Props {
  items: readonly AdminExtensionViewLink[];
  currentPath: string;
  onNavigate: (path: string) => void;
}

export function NavExtensionViews({ items, currentPath, onNavigate }: Props) {
  const { locale, tr } = useAdminLocale();
  if (items.length === 0) return null;
  return (
    <nav aria-label={tr("Plugin pages")} className="space-y-1 text-[13px]">
      <p className="px-2.5 text-xs font-semibold text-muted-foreground">{tr("Plugin pages")}</p>
      {items.map((item) => {
        const path = `/admin/extensions/${item.pluginId}/${item.viewId}`;
        const active = currentPath === path;
        return (
          <button
            key={path}
            type="button"
            onClick={() => onNavigate(path)}
            aria-current={active ? "page" : undefined}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-start font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${active
              ? "bg-sidebar-accent text-foreground font-semibold border border-sidebar-border/60"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"}`}
          >
            <Puzzle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span dir="auto" className="min-w-0 truncate" title={item.label[locale]}>
              {item.label[locale]}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
