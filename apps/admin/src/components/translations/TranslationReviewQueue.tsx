import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminQueryKeys } from "../../lib/query-keys";
import {
  fetchTranslationQueue,
  approveTranslationApi,
  TranslationQueueItem,
} from "../../lib/api";
import { Button } from "../ui/button";
import {
  Clock,
  AlertTriangle,
  FileQuestion,
  ArrowLeft,
  CheckCheck,
  CheckCircle2,
  ArrowRight,
  RefreshCw,
  Sparkles,
} from "lucide-react";

interface TranslationReviewQueueProps {
  onNavigate: (path: string) => void;
  canPublish?: boolean | undefined;
}

const LOCALE_NATIVE_NAMES: Record<string, { name: string; native: string }> = {
  en: { name: "English", native: "English" },
  "en-US": { name: "English (US)", native: "English" },
  "ar-SA": { name: "Arabic (Saudi)", native: "العربية" },
  ar: { name: "Arabic", native: "العربية" },
  "fr-FR": { name: "French", native: "Français" },
  fr: { name: "French", native: "Français" },
  "fa-IR": { name: "Persian", native: "فارسی" },
  fa: { name: "Persian", native: "فارسی" },
};

export const TranslationReviewQueue: React.FC<TranslationReviewQueueProps> = ({
  onNavigate,
  canPublish = true,
}) => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"stale" | "needsReview" | "missing">("stale");

  const { data: queueData, isLoading, refetch } = useQuery({
    queryKey: adminQueryKeys.translations.queue(),
    queryFn: fetchTranslationQueue,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveTranslationApi(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.translations.all });
    },
  });

  const handleOpenItem = (item: TranslationQueueItem) => {
    if (item.translationId) {
      onNavigate(`/admin/translations/${item.translationId}`);
    } else {
      onNavigate(`/admin/content/${item.contentType}/${item.contentId}/translate/${item.targetLocale}`);
    }
  };

  const staleItems = queueData?.stale || [];
  const needsReviewItems = queueData?.needsReview || [];
  const missingItems = queueData?.missing || [];

  const currentItems =
    activeTab === "stale"
      ? staleItems
      : activeTab === "needsReview"
      ? needsReviewItems
      : missingItems;

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto px-2 sm:px-4 py-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/50 pb-5">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onNavigate("/admin/translations")}
            className="gap-2 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Matrix</span>
          </Button>
          <div className="h-4 w-[1px] bg-border" />
          <div>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-amber-500" />
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Editorial Review Queue
              </h1>
            </div>
            <p className="text-xs text-muted-foreground">
              Prioritized translation tasks: stale published content, review submissions, and missing coverage.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="gap-2 cursor-pointer text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh Queue</span>
          </Button>
        </div>
      </div>

      {/* Queue Tabs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => setActiveTab("stale")}
          className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
            activeTab === "stale"
              ? "bg-rose-500/10 border-rose-500/40 text-foreground shadow-xs"
              : "bg-card border-border/60 hover:bg-muted/30 text-muted-foreground"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="h-4 w-4" />
              <span>Stale Translations</span>
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-700 dark:text-rose-300">
              {staleItems.length}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Live published content whose source was modified.
          </p>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("needsReview")}
          className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
            activeTab === "needsReview"
              ? "bg-amber-500/10 border-amber-500/40 text-foreground shadow-xs"
              : "bg-card border-border/60 hover:bg-muted/30 text-muted-foreground"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
              <Clock className="h-4 w-4" />
              <span>Needs Review</span>
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-700 dark:text-amber-300">
              {needsReviewItems.length}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            AI translations & submitted drafts awaiting approval.
          </p>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("missing")}
          className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
            activeTab === "missing"
              ? "bg-primary/10 border-primary/40 text-foreground shadow-xs"
              : "bg-card border-border/60 hover:bg-muted/30 text-muted-foreground"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-primary">
              <FileQuestion className="h-4 w-4" />
              <span>Untranslated</span>
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-primary/20 text-primary">
              {missingItems.length}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Published content without translation in active locales.
          </p>
        </button>
      </div>

      {/* Queue Items List */}
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-xs">
        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground flex items-center justify-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-primary" />
            <span>Loading review queue...</span>
          </div>
        ) : currentItems.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground space-y-2">
            <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto" />
            <p className="font-semibold text-foreground text-sm">All caught up!</p>
            <p className="text-xs text-muted-foreground">
              No items currently require attention in this category.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {currentItems.map((item) => {
              const targetMeta = LOCALE_NATIVE_NAMES[item.targetLocale] || {
                name: item.targetLocale,
                native: item.targetLocale,
              };

              return (
                <div
                  key={item.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-muted/30 transition-colors"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground text-sm">
                        {item.contentTitle}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground uppercase">
                        {item.contentType}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-primary/10 text-primary border border-primary/20">
                        ➔ {targetMeta.native} ({item.targetLocale})
                      </span>
                      {item.translationProvider?.startsWith("ai:") && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 flex items-center gap-1">
                          <Sparkles className="h-3 w-3" />
                          <span>AI Generated</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>Source updated: {new Date(item.sourceUpdatedAt).toLocaleDateString()}</span>
                      {item.translatedAt && (
                        <>
                          <span>•</span>
                          <span>
                            Translated: {new Date(item.translatedAt).toLocaleDateString()}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {canPublish && item.status === "needs_review" && item.translationId && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => approveMutation.mutate(item.translationId!)}
                        disabled={approveMutation.isPending}
                        className="h-8 text-xs cursor-pointer text-sky-600 dark:text-sky-400 border-sky-500/30 gap-1"
                      >
                        <CheckCheck className="h-3.5 w-3.5" />
                        <span>Approve</span>
                      </Button>
                    )}

                    <Button
                      size="sm"
                      onClick={() => handleOpenItem(item)}
                      className="h-8 text-xs cursor-pointer gap-1.5 bg-primary text-primary-foreground font-semibold"
                    >
                      <span>{item.translationId ? "Open Workspace" : "Translate Now"}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
