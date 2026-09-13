import React, { useState, useEffect } from "react";
import {
  Sparkles,
  Bell,
  Zap,
  Info,
  Star,
  Rocket,
  ArrowRight,
  X,
  LucideIcon,
} from "lucide-react";
import { Badge } from "../../ui/badge";
import {
  getWhatsNewApi,
  dismissWhatsNewApi,
  isSafeWhatsNewUrl,
  WhatsNewItem,
} from "../../../lib/api/whats-new";

const WHATS_NEW_ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  bell: Bell,
  zap: Zap,
  info: Info,
  star: Star,
  rocket: Rocket,
};

interface AppSidebarBannerProps {
  onNavigate?: (path: string) => void;
}

export const AppSidebarBanner: React.FC<AppSidebarBannerProps> = ({
  onNavigate,
}) => {
  const [item, setItem] = useState<WhatsNewItem | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadWhatsNew() {
      try {
        const response = await getWhatsNewApi();
        if (isMounted) {
          setItem(response.item ?? null);
          setLoaded(true);
        }
      } catch {
        // Fail silently without breaking Admin: render null
        if (isMounted) {
          setItem(null);
          setLoaded(true);
        }
      }
    }

    loadWhatsNew();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleDismiss = async () => {
    if (!item) return;

    const notificationId = item.id;
    // 1. Optimistic UI update: immediately hide card
    setIsDismissed(true);

    // 2. Persist dismissal to authenticated user profile in DB
    try {
      await dismissWhatsNewApi(notificationId);
    } catch {
      // Failed dismissal is logged silently; idempotent retry on next action
    }
  };

  const handleActionClick = (e: React.MouseEvent) => {
    if (!item?.url || !isSafeWhatsNewUrl(item.url)) return;

    if (item.url.startsWith("/") && onNavigate) {
      e.preventDefault();
      onNavigate(item.url);
    }
  };

  // If not loaded, no eligible item, or dismissed: render nothing (null)
  if (!loaded || !item || isDismissed) {
    return null;
  }

  // Safe icon lookup (fallback to Sparkles)
  const IconComponent =
    (item.icon && WHATS_NEW_ICONS[item.icon.toLowerCase()]) || Sparkles;

  const hasSafeUrl = Boolean(item.url && isSafeWhatsNewUrl(item.url));

  return (
    <div
      data-testid="whats-new-banner"
      data-notification-id={item.id}
      className="relative group"
    >
      {/* Vibress Signature Wide Spread Ambient Glow (Behind Card) */}
      <div className="absolute -inset-1.5 bg-gradient-to-r from-purple-600 via-pink-500 to-indigo-600 rounded-2xl opacity-20 dark:opacity-25 blur-lg group-hover:opacity-40 group-hover:blur-xl transition-all duration-500" />

      {/* Card Content Container */}
      <div className="relative p-3.5 rounded-xl bg-card border border-border text-card-foreground shadow-sm space-y-1.5 transition-all overflow-hidden">
        {/* Top-Right & Bottom-Left Rich Mesh Glow inside card */}
        <div className="absolute -top-12 -right-12 w-36 h-36 bg-gradient-to-br from-purple-500/40 via-pink-500/30 to-transparent rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-28 h-28 bg-gradient-to-tr from-indigo-500/30 via-purple-500/20 to-blue-500/0 rounded-full blur-xl pointer-events-none" />

        <div className="relative flex items-center justify-between z-10">
          <Badge
            variant="outline"
            className="text-[10px] font-bold text-purple-600 dark:text-purple-300 border-purple-500/30 bg-purple-500/15 gap-1 px-1.5 py-0 shadow-2xs"
          >
            <IconComponent className="h-3 w-3 text-purple-500" /> WHAT'S NEW?
          </Badge>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer p-0.5 rounded-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
            title="Close notification"
            aria-label="Close notification"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        <h4 className="relative text-xs font-bold leading-snug text-foreground z-10">
          {item.title}
        </h4>
        <p className="relative text-[11px] text-muted-foreground leading-normal z-10">
          {item.description}
        </p>

        {hasSafeUrl && (
          <div className="relative pt-1 z-10">
            <a
              href={item.url}
              onClick={handleActionClick}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 hover:underline transition-colors focus:outline-none focus:ring-1 focus:ring-purple-500 rounded-xs"
            >
              Learn more
              <ArrowRight className="h-2.5 w-2.5" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
};
