import React, { useState, useEffect } from "react";
import { SettingsCard } from "../SettingsCard";
import { SettingsCardRow } from "../SettingsCardRow";
import { Database } from "lucide-react";
import { Badge } from "../../ui/badge";
import { apiRequest } from "../../../lib/api";

interface ContentModelerCardProps {
  isHighlighted?: boolean | undefined;
  onNavigate?: ((path: string) => void) | undefined;
}

export const ContentModelerCard: React.FC<ContentModelerCardProps> = ({
  isHighlighted,
  onNavigate,
}) => {
  const [modelCount, setModelCount] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    apiRequest<{ data?: unknown[]; models?: unknown[] }>("/content-models")
      .then((res) => {
        if (!mounted) return;
        const list = res.data || res.models || [];
        setModelCount(list.length);
      })
      .catch(() => {
        // graceful fallback if not seeded or api unavailable
      });
    return () => {
      mounted = false;
    };
  }, []);

  const [isArabic, setIsArabic] = useState<boolean>(() => {
    return (
      typeof document !== "undefined" &&
      (document.documentElement.lang === "ar" ||
        document.documentElement.dir === "rtl")
    );
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const updateLocale = () => {
      setIsArabic(
        document.documentElement.lang === "ar" ||
          document.documentElement.dir === "rtl",
      );
    };
    updateLocale();
    const observer = new MutationObserver(updateLocale);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang", "dir"],
    });
    return () => observer.disconnect();
  }, []);

  const handleAction = () => {
    if (onNavigate) {
      onNavigate("/admin/models");
    } else if (typeof window !== "undefined") {
      window.history.pushState({}, "", "/admin/models");
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  };

  const title = isArabic ? "نمذجة المحتوى" : "Content Modeler";
  const description = isArabic
    ? "صمّم نماذج محتوى منظمة وحقولًا وعلاقات وواجهات للمجموعات."
    : "Design custom structured content models, fields, relations, and collection APIs.";
  const actionLabel = isArabic ? "إدارة النماذج" : "Manage models";

  return (
    <SettingsCard id="advanced-content-modeler" isHighlighted={isHighlighted}>
      <SettingsCardRow
        icon={<Database className="h-4 w-4" />}
        title={title}
        description={description}
        currentValue={
          modelCount !== null ? (
            <Badge
              variant="secondary"
              className="text-xs font-mono gap-1 text-sky-600 dark:text-sky-400"
            >
              <Database className="h-3 w-3" />
              <span>
                {modelCount}{" "}
                {modelCount === 1
                  ? isArabic
                    ? "نموذج"
                    : "Model"
                  : isArabic
                  ? "نماذج"
                  : "Models"}
              </span>
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs font-mono">
              {isArabic ? "محرك المخطط جاهز" : "Schema Engine Ready"}
            </Badge>
          )
        }
        actionLabel={actionLabel}
        onAction={handleAction}
      />
    </SettingsCard>
  );
};
