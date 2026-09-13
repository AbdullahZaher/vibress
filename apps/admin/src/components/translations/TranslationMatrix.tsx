import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminQueryKeys } from "../../lib/query-keys";
import {
  fetchTranslationMatrix,
  fetchLocalizationHealth,
  bulkUpdateTranslationsApi,
  TranslationMatrixItem,
} from "../../lib/api";
import { TranslationBadge } from "./TranslationBadge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Globe,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  Layers,
  CheckSquare,
  Square,
} from "lucide-react";

interface TranslationMatrixProps {
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
  "es-ES": { name: "Spanish", native: "Español", dir: "ltr" },
  es: { name: "Spanish", native: "Español", dir: "ltr" },
};

export const TranslationMatrix: React.FC<TranslationMatrixProps> = ({ onNavigate }) => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [contentType, setContentType] = useState<"all" | "post" | "page">("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const pageSize = 15;

  // 1. Fetch Matrix Data
  const { data: matrixData, isLoading: matrixLoading, refetch } = useQuery({
    queryKey: adminQueryKeys.translations.matrix({
      search: search || undefined,
      contentType: contentType === "all" ? undefined : contentType,
      status: statusFilter === "all" ? undefined : statusFilter,
      offset: page * pageSize,
      limit: pageSize,
    }),
    queryFn: () =>
      fetchTranslationMatrix({
        search: search || undefined,
        contentType: contentType === "all" ? undefined : contentType,
        status: statusFilter === "all" ? undefined : statusFilter,
        offset: page * pageSize,
        limit: pageSize,
      }),
  });

  // 2. Fetch Localization Health Metrics
  const { data: healthData } = useQuery({
    queryKey: adminQueryKeys.translations.health(),
    queryFn: fetchLocalizationHealth,
  });

  // 3. Bulk Action Mutation
  const bulkMutation = useMutation({
    mutationFn: bulkUpdateTranslationsApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.translations.all });
      setSelectedIds([]);
    },
  });

  const enabledLocales = matrixData?.enabledLocales || ["en", "ar-SA"];
  const defaultLocale = matrixData?.defaultLocale || "en";

  const handleSelectAll = () => {
    if (!matrixData?.items) return;
    if (selectedIds.length === matrixData.items.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(matrixData.items.map((i) => i.id));
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleCellClick = (item: TranslationMatrixItem, locale: string) => {
    const locEntry = item.locales[locale];
    if (locale === defaultLocale || locale.split("-")[0] === defaultLocale) {
      // Navigate to source editor
      if (item.contentType === "post") {
        onNavigate(`/admin/posts/${item.id}`);
      } else {
        onNavigate(`/admin/pages/${item.id}`);
      }
      return;
    }

    if (locEntry?.translationId) {
      onNavigate(`/admin/translations/${locEntry.translationId}`);
    } else {
      onNavigate(`/admin/content/${item.contentType}/${item.id}/translate/${locale}`);
    }
  };

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto px-2 sm:px-4 py-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/50 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Globe className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                Translation Matrix
              </h1>
              <p className="text-sm text-muted-foreground">
                Manage multilingual content coverage, editorial review workflows, and localization health.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            onClick={() => onNavigate("/admin/translations/queue")}
            className="gap-2 cursor-pointer relative"
          >
            <Clock className="h-4 w-4 text-amber-500" />
            <span>Review Queue</span>
            {healthData && healthData.needsReviewCount > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-white">
                {healthData.needsReviewCount}
              </span>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => onNavigate("/admin/settings/localization")}
            className="gap-2 cursor-pointer"
          >
            <Globe className="h-4 w-4 text-primary" />
            <span>Manage Locales</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            className="cursor-pointer"
            title="Refresh matrix"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Health Overview Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-card border border-border/60 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
            <span>Source Content</span>
            <Layers className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
            {healthData?.totalSourceItems ?? "—"}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Posts & Pages published in {defaultLocale.toUpperCase()}
          </p>
        </div>

        <div className="p-4 rounded-xl bg-card border border-border/60 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
            <span>Overall Coverage</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
            {healthData ? `${healthData.overallCoveragePercentage}%` : "—"}
          </div>
          <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${healthData?.overallCoveragePercentage ?? 0}%` }}
            />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-card border border-border/60 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
            <span>Stale (Outdated)</span>
            <AlertTriangle className="h-4 w-4 text-rose-500" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
            {healthData?.staleCount ?? 0}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Source modified after translation
          </p>
        </div>

        <div className="p-4 rounded-xl bg-card border border-border/60 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
            <span>Awaiting Review</span>
            <Clock className="h-4 w-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
            {healthData?.needsReviewCount ?? 0}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Drafts & AI translations to approve
          </p>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-card border border-border/60 rounded-xl shadow-xs">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute start-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Search content title or slug..."
              className="ps-9 text-xs sm:text-sm"
            />
          </div>

          <div className="flex items-center bg-muted/60 p-1 rounded-lg border border-border/60 text-xs">
            <button
              type="button"
              onClick={() => {
                setContentType("all");
                setPage(0);
              }}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                contentType === "all"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All Content
            </button>
            <button
              type="button"
              onClick={() => {
                setContentType("post");
                setPage(0);
              }}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                contentType === "post"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Posts
            </button>
            <button
              type="button"
              onClick={() => {
                setContentType("page");
                setPage(0);
              }}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                contentType === "page"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Pages
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(0);
            }}
            className="h-9 px-3 py-1 bg-background border border-border rounded-lg text-xs font-medium text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Statuses</option>
            <option value="published">Published</option>
            <option value="stale">Stale (Outdated)</option>
            <option value="needs_review">Needs Review</option>
            <option value="draft">Draft / In Progress</option>
            <option value="untranslated">Missing</option>
          </select>
        </div>
      </div>

      {/* Bulk Action Bar (When rows selected) */}
      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between p-3 bg-primary/10 border border-primary/30 rounded-xl text-xs animate-in fade-in duration-150">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-primary">
              {selectedIds.length} item{selectedIds.length > 1 ? "s" : ""} selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => bulkMutation.mutate({ translationIds: selectedIds, action: "submit_review" })}
              disabled={bulkMutation.isPending}
              className="h-8 text-xs cursor-pointer"
            >
              Submit for Review
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelectedIds([])}
              className="h-8 text-xs cursor-pointer"
            >
              Clear Selection
            </Button>
          </div>
        </div>
      )}

      {/* Matrix Table */}
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-border/60 bg-muted/40 text-xs font-semibold text-muted-foreground">
                <th className="py-3 px-4 w-10">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="cursor-pointer text-muted-foreground hover:text-foreground"
                    title="Select all"
                  >
                    {matrixData?.items && selectedIds.length === matrixData.items.length ? (
                      <CheckSquare className="h-4 w-4 text-primary" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </button>
                </th>
                <th className="py-3 px-4 min-w-[240px]">Content Item</th>
                {enabledLocales.map((locale) => {
                  const locInfo = LOCALE_NATIVE_NAMES[locale] || {
                    name: locale,
                    native: locale,
                    dir: "ltr",
                  };
                  const isDefault = locale === defaultLocale || locale.split("-")[0] === defaultLocale;

                  return (
                    <th key={locale} className="py-3 px-4 min-w-[170px]">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-foreground">{locInfo.native}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          ({locale})
                        </span>
                        {isDefault && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-primary/10 text-primary border border-primary/20">
                            Source
                          </span>
                        )}
                        <span className="text-[9px] uppercase px-1 py-0.2 rounded bg-muted text-muted-foreground">
                          {locInfo.dir}
                        </span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {matrixLoading ? (
                <tr>
                  <td
                    colSpan={enabledLocales.length + 2}
                    className="py-12 text-center text-muted-foreground"
                  >
                    <div className="flex items-center justify-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                      <span>Loading translation matrix...</span>
                    </div>
                  </td>
                </tr>
              ) : matrixData?.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={enabledLocales.length + 2}
                    className="py-12 text-center text-muted-foreground"
                  >
                    No content items match the current filters.
                  </td>
                </tr>
              ) : (
                matrixData?.items.map((item) => {
                  const isSelected = selectedIds.includes(item.id);

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-muted/30 transition-colors ${
                        isSelected ? "bg-primary/5" : ""
                      }`}
                    >
                      <td className="py-3.5 px-4">
                        <button
                          type="button"
                          onClick={() => handleToggleSelect(item.id)}
                          className="cursor-pointer text-muted-foreground hover:text-foreground"
                        >
                          {isSelected ? (
                            <CheckSquare className="h-4 w-4 text-primary" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </button>
                      </td>

                      {/* Content Title & Type */}
                      <td className="py-3.5 px-4">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground hover:text-primary transition-colors">
                              {item.title}
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground uppercase">
                              {item.contentType}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono">/{item.slug}</span>
                            <span>•</span>
                            <span className="capitalize">{item.sourceStatus}</span>
                          </div>
                        </div>
                      </td>

                      {/* Locales Columns */}
                      {enabledLocales.map((locale) => {
                        const locStat = item.locales[locale];

                        return (
                          <td key={locale} className="py-3.5 px-4">
                            <div className="flex items-center gap-2">
                              <TranslationBadge
                                status={locStat?.status || "untranslated"}
                                isStale={locStat?.isStale}
                                onClick={() => handleCellClick(item, locale)}
                              />
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {matrixData && matrixData.total > pageSize && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border/60 bg-muted/20 text-xs text-muted-foreground">
            <div>
              Showing {page * pageSize + 1}–
              {Math.min((page + 1) * pageSize, matrixData.total)} of {matrixData.total} items
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="h-7 text-xs cursor-pointer"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={(page + 1) * pageSize >= matrixData.total}
                onClick={() => setPage((p) => p + 1)}
                className="h-7 text-xs cursor-pointer"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
