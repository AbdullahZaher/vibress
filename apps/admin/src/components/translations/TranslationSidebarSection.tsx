import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminQueryKeys } from "../../lib/query-keys";
import {
  fetchContentTranslations,
  fetchTranslationMatrix,
  aiTranslateContent,
} from "../../lib/api";
import { TranslationBadge } from "./TranslationBadge";
import { Button } from "../ui/button";
import {
  Globe,
  Plus,
  Sparkles,
  ExternalLink,
  RefreshCw,
} from "lucide-react";

interface TranslationSidebarSectionProps {
  contentType: "post" | "page";
  contentId: string;
  onNavigate: (path: string) => void;
}

const LOCALE_NATIVE_NAMES: Record<string, { name: string; native: string; dir: "ltr" | "rtl" }> = {
  en: { name: "English", native: "English", dir: "ltr" },
  "en-US": { name: "English (US)", native: "English", dir: "ltr" },
  "ar-SA": { name: "Arabic (Saudi)", native: "العربية", dir: "rtl" },
  ar: { name: "Arabic", native: "العربية", dir: "rtl" },
  "fr-FR": { name: "French", native: "Français", dir: "ltr" },
  fr: { name: "French", native: "Français", dir: "ltr" },
  "fa-IR": { name: "Persian", native: "فارسی", dir: "rtl" },
  fa: { name: "Persian", native: "فارسی", dir: "rtl" },
  "de-DE": { name: "German", native: "Deutsch", dir: "ltr" },
  de: { name: "German", native: "Deutsch", dir: "ltr" },
};

export const TranslationSidebarSection: React.FC<TranslationSidebarSectionProps> = ({
  contentType,
  contentId,
  onNavigate,
}) => {
  const queryClient = useQueryClient();
  const [aiLoadingLocale, setAiLoadingLocale] = useState<string | null>(null);

  // 1. Fetch enabled publication locales
  const { data: matrixData } = useQuery({
    queryKey: adminQueryKeys.translations.matrix({ limit: 1 }),
    queryFn: () => fetchTranslationMatrix({ limit: 1 }),
  });

  // 2. Fetch existing translations for this content
  const { data: trData, isLoading } = useQuery({
    queryKey: adminQueryKeys.translations.content(contentType, contentId),
    queryFn: () => fetchContentTranslations(contentType, contentId),
    enabled: Boolean(contentId),
  });

  const aiMutation = useMutation({
    mutationFn: (targetLocale: string) =>
      aiTranslateContent(contentType, contentId, { targetLocale }),
    onSuccess: (data) => {
      setAiLoadingLocale(null);
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.translations.all });
      onNavigate(`/admin/translations/${data.translation.id}`);
    },
    onError: () => {
      setAiLoadingLocale(null);
    },
  });

  const enabledLocales = matrixData?.enabledLocales || ["en", "ar-SA"];
  const defaultLocale = matrixData?.defaultLocale || "en";
  const translations = trData?.translations || [];

  // Filter out source locale
  const targetLocales = enabledLocales.filter((l) => {
    const baseLoc = l.split("-")[0] || l;
    return l !== defaultLocale && baseLoc !== defaultLocale;
  });

  const handleAiTranslate = (loc: string) => {
    setAiLoadingLocale(loc);
    aiMutation.mutate(loc);
  };

  return (
    <div className="p-3 bg-card border border-border/60 rounded-xl space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          <span className="text-xs font-bold text-foreground uppercase tracking-wider">
            Translations
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onNavigate("/admin/translations")}
          className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
        >
          View Matrix
        </Button>
      </div>

      {isLoading ? (
        <div className="py-3 text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
          <RefreshCw className="h-3 w-3 animate-spin text-primary" />
          <span>Loading locales...</span>
        </div>
      ) : targetLocales.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No secondary locales enabled for this publication.
        </p>
      ) : (
        <div className="space-y-2">
          {targetLocales.map((loc) => {
            const locMeta = LOCALE_NATIVE_NAMES[loc] || {
              name: loc,
              native: loc,
              dir: "ltr",
            };
            const existingTr = translations.find((t) => t.targetLocale === loc);
            const isAiLoading = aiLoadingLocale === loc;

            return (
              <div
                key={loc}
                className="p-2.5 rounded-lg bg-muted/40 border border-border/40 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-foreground">
                      {locMeta.native}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      ({loc})
                    </span>
                  </div>
                  <TranslationBadge
                    status={existingTr?.status as any || "untranslated"}
                    isStale={existingTr?.isStale}
                  />
                </div>

                <div className="flex items-center gap-1.5 pt-1 border-t border-border/30">
                  {existingTr ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onNavigate(`/admin/translations/${existingTr.id}`)}
                      className="h-7 text-[11px] flex-1 cursor-pointer gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>Edit Translation</span>
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          onNavigate(`/admin/content/${contentType}/${contentId}/translate/${loc}`)
                        }
                        className="h-7 text-[11px] flex-1 cursor-pointer gap-1"
                      >
                        <Plus className="h-3 w-3" />
                        <span>Translate</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleAiTranslate(loc)}
                        disabled={isAiLoading || aiMutation.isPending}
                        className="h-7 px-2 text-[11px] text-primary hover:bg-primary/10 cursor-pointer"
                        title="Translate draft with AI"
                      >
                        {isAiLoading ? (
                          <RefreshCw className="h-3 w-3 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3" />
                        )}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
