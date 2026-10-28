import { BookOpen, GraduationCap, Puzzle } from "lucide-react";
import type { AdminExtensionViewLink } from "../../../lib/api";
import { useAdminLocale } from "../../../lib/admin-locale";

interface Props {
  items: readonly AdminExtensionViewLink[];
  currentPath: string;
  onNavigate: (path: string) => void;
}

type IconKey = "puzzle" | "graduation-cap" | "book-open";
interface Section {
  key: string;
  label: string;
  icon: IconKey;
  items: readonly AdminExtensionViewLink[];
}

/** Host-owned sidebar; groups are only validated labels and icon IDs.
 * Existing ungrouped LMS and generic items keep their previous sections. */
export function NavExtensionViews({ items, currentPath, onNavigate }: Props) {
  const { locale, tr } = useAdminLocale();
  if (items.length === 0) return null;
  const legacyLms = items.filter((item) => !item.group && item.pluginId.toLowerCase().includes("lms"));
  const legacyOther = items.filter((item) => !item.group && !item.pluginId.toLowerCase().includes("lms"));
  const grouped = new Map<string, {
    label: string;
    icon: IconKey;
    items: AdminExtensionViewLink[];
  }>();
  for (const item of items) {
    if (!item.group) continue;
    const key = item.pluginId + ":" + item.group.id;
    const entry = grouped.get(key);
    if (entry) entry.items.push(item);
    else grouped.set(key, {
      label: item.group.label[locale],
      icon: item.group.icon ?? "puzzle",
      items: [item],
    });
  }

  const sections: Section[] = [
    ...(legacyLms.length > 0 ? [{
      key: "legacy-lms", label: tr("LMS"), icon: "graduation-cap" as const, items: legacyLms,
    }] : []),
    ...Array.from(grouped, ([key, value]) => ({ key, ...value })),
    ...(legacyOther.length > 0 ? [{
      key: "legacy-other", label: tr("Plugin pages"), icon: "puzzle" as const, items: legacyOther,
    }] : []),
  ];

  return (
    <div className="space-y-4">
      {sections.map((section) => {
        const Icon = section.icon === "graduation-cap"
          ? GraduationCap : section.icon === "book-open" ? BookOpen : Puzzle;
        return (
          <nav key={section.key} aria-label={section.label} className="space-y-1 text-[13px]">
            <p className="px-2.5 text-xs font-semibold text-muted-foreground" dir="auto">{section.label}</p>
            {section.items.map((item) => {
              const path = "/admin/extensions/" + item.pluginId + "/" + item.viewId;
              const active = currentPath === path;
              const className =
                "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-start font-medium transition-colors " +
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
                (active
                  ? "bg-sidebar-accent text-foreground font-semibold border border-sidebar-border/60"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground");
              return (
                <button
                  key={path}
                  type="button"
                  onClick={() => onNavigate(path)}
                  aria-current={active ? "page" : undefined}
                  className={className}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span dir="auto" className="min-w-0 truncate" title={item.label[locale]}>
                    {item.label[locale]}
                  </span>
                </button>
              );
            })}
          </nav>
        );
      })}
    </div>
  );
}
