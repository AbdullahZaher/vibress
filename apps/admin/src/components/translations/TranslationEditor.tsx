import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminQueryKeys } from "../../lib/query-keys";
import {
  fetchTranslationDetail,
  createContentTranslation,
  updateTranslationApi,
  submitTranslationForReview,
  approveTranslationApi,
  publishTranslationApi,
  aiTranslateContent,
  apiRequest,
} from "../../lib/api";
import { TranslationBadge } from "./TranslationBadge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import {
  ArrowLeft,
  Save,
  Send,
  CheckCheck,
  Globe,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  BookOpen,
} from "lucide-react";

interface TranslationEditorProps {
  translationId?: string | undefined;
  contentType?: "post" | "page" | undefined;
  contentId?: string | undefined;
  targetLocale?: string | undefined;
  onNavigate: (path: string) => void;
  canPublish?: boolean | undefined;
}

const LOCALE_META: Record<string, { name: string; native: string; dir: "ltr" | "rtl" }> = {
  en: { name: "English", native: "English", dir: "ltr" },
  "en-US": { name: "English (US)", native: "English", dir: "ltr" },
  "ar-SA": { name: "Arabic (Saudi Arabia)", native: "العربية", dir: "rtl" },
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

export const TranslationEditor: React.FC<TranslationEditorProps> = ({
  translationId: initialTranslationId,
  contentType = "post",
  contentId,
  targetLocale = "ar-SA",
  onNavigate,
  canPublish = true,
}) => {
  const queryClient = useQueryClient();
  const [currentTranslationId, setCurrentTranslationId] = useState<string | undefined>(
    initialTranslationId,
  );

  // Form State
  const [targetTitle, setTargetTitle] = useState("");
  const [targetSlug, setTargetSlug] = useState("");
  const [targetExcerpt, setTargetExcerpt] = useState("");
  const [targetBody, setTargetBody] = useState("");
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [status, setStatus] = useState<string>("draft");
  const [showDiff, setShowDiff] = useState(false);
  const [activeMobileTab, setActiveMobileTab] = useState<"source" | "target">("target");
  const [aiProvider, setAiProvider] = useState("auto");
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Source item state if loaded directly by contentId
  const [sourceItem, setSourceItem] = useState<{
    title: string;
    slug: string;
    excerpt: string | null;
    content: string;
    updatedAt: string;
  } | null>(null);

  // 1. Fetch translation if translationId exists
  const { data: detailData } = useQuery({
    queryKey: adminQueryKeys.translations.detail(currentTranslationId || "none"),
    queryFn: () => fetchTranslationDetail(currentTranslationId!),
    enabled: Boolean(currentTranslationId),
  });

  // 2. Fetch source content directly if creating new translation
  useEffect(() => {
    async function loadSourceDirectly() {
      if (!currentTranslationId && contentId) {
        try {
          const endpoint = contentType === "post" ? `/posts/${contentId}` : `/pages/${contentId}`;
          const res = await apiRequest<{ post?: any; page?: any }>(endpoint);
          const item = res.post || res.page;
          if (item) {
            setSourceItem({
              title: item.title,
              slug: item.slug,
              excerpt: item.excerpt,
              content: typeof item.content === "string" ? item.content : JSON.stringify(item.content, null, 2),
              updatedAt: item.updatedAt,
            });
            // Also check if translation already exists
            const trList = await apiRequest<{ translations: any[] }>(
              `/content/${contentType}/${contentId}/translations`,
            );
            const match = trList.translations?.find((t) => t.targetLocale === targetLocale);
            if (match) {
              setCurrentTranslationId(match.id);
            }
          }
        } catch (err: any) {
          setErrorMsg(err.message);
        }
      }
    }
    loadSourceDirectly();
  }, [contentId, contentType, targetLocale, currentTranslationId]);

  // Sync state when detail data arrives
  useEffect(() => {
    if (detailData?.translation) {
      const tr = detailData.translation;
      setTargetTitle(tr.title || "");
      setTargetSlug(tr.slug || "");
      setTargetExcerpt(tr.excerpt || "");
      setTargetBody(
        typeof tr.content === "string"
          ? tr.content
          : JSON.stringify(tr.content, null, 2),
      );
      setMetaTitle(tr.metaTitle || "");
      setMetaDescription(tr.metaDescription || "");
      setStatus(tr.status);
    }
    if (detailData?.source) {
      setSourceItem({
        title: detailData.source.title,
        slug: detailData.source.slug,
        excerpt: detailData.source.excerpt,
        content:
          typeof detailData.source.content === "string"
            ? detailData.source.content
            : JSON.stringify(detailData.source.content, null, 2),
        updatedAt: detailData.source.updatedAt,
      });
    }
  }, [detailData]);

  const targetMeta = LOCALE_META[targetLocale] || {
    name: targetLocale,
    native: targetLocale,
    dir: "ltr",
  };
  const isTargetRtl = targetMeta.dir === "rtl";

  // Mutations
  const saveMutation = useMutation({
    mutationFn: async (targetStatus?: string) => {
      setErrorMsg(null);
      setSuccessMsg(null);

      const payload = {
        targetLocale,
        title: targetTitle,
        slug: targetSlug || `${sourceItem?.slug || "item"}-${targetLocale.slice(0, 2)}`,
        excerpt: targetExcerpt,
        content: { body: targetBody },
        metaTitle,
        metaDescription,
        status: targetStatus || status,
      };

      if (currentTranslationId) {
        const res = await updateTranslationApi(currentTranslationId, payload);
        return res.translation;
      } else if (contentId) {
        const res = await createContentTranslation(contentType, contentId, payload);
        setCurrentTranslationId(res.translation.id);
        return res.translation;
      }
      throw new Error("Missing contentId or translationId");
    },
    onSuccess: (saved) => {
      setStatus(saved.status);
      setSuccessMsg("Translation saved successfully.");
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.translations.all });
      setTimeout(() => setSuccessMsg(null), 4000);
    },
    onError: (err: any) => {
      setErrorMsg(err.message);
    },
  });

  const submitReviewMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null);
      const saved = await saveMutation.mutateAsync("needs_review");
      const targetId = saved?.id || currentTranslationId;
      if (!targetId) throw new Error("Could not determine translation identifier");
      const res = await submitTranslationForReview(targetId);
      return res.translation;
    },
    onSuccess: (res) => {
      if (res) setStatus(res.status);
      setSuccessMsg("Submitted for review successfully.");
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.translations.all });
      setTimeout(() => setSuccessMsg(null), 4000);
    },
    onError: (err: any) => {
      setErrorMsg(`Failed to submit for review: ${err.message || "Unknown error"}`);
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null);
      const saved = await saveMutation.mutateAsync("approved");
      const targetId = saved?.id || currentTranslationId;
      if (!targetId) throw new Error("Could not determine translation identifier");
      const res = await approveTranslationApi(targetId);
      return res.translation;
    },
    onSuccess: (res) => {
      if (res) setStatus(res.status);
      setSuccessMsg("Translation approved.");
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.translations.all });
      setTimeout(() => setSuccessMsg(null), 4000);
    },
    onError: (err: any) => {
      setErrorMsg(`Failed to approve translation: ${err.message || "Unknown error"}`);
    },
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null);
      const saved = await saveMutation.mutateAsync("published");
      const targetId = saved?.id || currentTranslationId;
      if (!targetId) throw new Error("Could not determine translation identifier");
      const res = await publishTranslationApi(targetId);
      return res.translation;
    },
    onSuccess: (res) => {
      if (res) setStatus(res.status);
      setSuccessMsg("Translation published successfully!");
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.translations.all });
      setTimeout(() => setSuccessMsg(null), 4000);
    },
    onError: (err: any) => {
      setErrorMsg(`Failed to publish translation: ${err.message || "Unknown error"}`);
    },
  });

  const aiMutation = useMutation({
    mutationFn: async () => {
      const cid = contentId || detailData?.translation?.contentId;
      const ctype = contentType || detailData?.translation?.contentType || "post";
      if (!cid) throw new Error("Missing content identifier");

      const res = await aiTranslateContent(ctype, cid, {
        targetLocale,
        provider: aiProvider === "auto" ? undefined : aiProvider,
      });
      return res.translation;
    },
    onSuccess: (tr) => {
      setCurrentTranslationId(tr.id);
      setTargetTitle(tr.title || "");
      setTargetSlug(tr.slug || "");
      setTargetExcerpt(tr.excerpt || "");
      setStatus("needs_review");
      setSuccessMsg("AI draft generated and placed in 'Needs Review' status.");
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.translations.all });
      setTimeout(() => setSuccessMsg(null), 4000);
    },
    onError: (err: any) => {
      setErrorMsg(`AI translation error: ${err.message}`);
    },
  });

  const isStale = detailData?.translation?.isStale;

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto px-2 sm:px-4 py-4">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/50 pb-4">
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
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                Translation Workspace
              </h1>
              <TranslationBadge status={status as any} isStale={isStale} />
            </div>
            <p className="text-xs text-muted-foreground">
              Source (English) ➔ Target ({targetMeta.native} / {targetLocale})
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => saveMutation.mutate("draft")}
            disabled={saveMutation.isPending}
            className="gap-1.5 cursor-pointer text-xs"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{saveMutation.isPending ? "Saving..." : "Save Draft"}</span>
          </Button>

          {status !== "needs_review" && status !== "approved" && status !== "published" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => submitReviewMutation.mutate()}
              disabled={submitReviewMutation.isPending}
              className="gap-1.5 cursor-pointer text-xs text-amber-600 dark:text-amber-400 border-amber-500/30"
            >
              <Send className="h-3.5 w-3.5" />
              <span>Submit for Review</span>
            </Button>
          )}

          {canPublish && (status === "needs_review" || status === "draft" || isStale) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
              className="gap-1.5 cursor-pointer text-xs text-sky-600 dark:text-sky-400 border-sky-500/30"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              <span>Approve</span>
            </Button>
          )}

          {canPublish && (
            <Button
              size="sm"
              onClick={() => publishMutation.mutate()}
              disabled={publishMutation.isPending}
              className="gap-1.5 cursor-pointer text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Publish Translation</span>
            </Button>
          )}
        </div>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 rounded-xl text-xs animate-in fade-in duration-150">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 text-destructive rounded-xl text-xs animate-in fade-in duration-150">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Stale Warning & Diff Toggle */}
      {isStale && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-semibold text-xs">
              <AlertTriangle className="h-4 w-4" />
              <span>Source content was modified after this translation was created.</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDiff(!showDiff)}
              className="h-7 text-xs cursor-pointer border-amber-500/40 text-amber-700 dark:text-amber-300"
            >
              {showDiff ? "Hide Source Changes" : "View Source Diff"}
            </Button>
          </div>

          {/* Field-level change badges */}
          {detailData?.translation?.fieldDiff?.changedFields &&
            detailData.translation.fieldDiff.changedFields.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                <span className="text-[11px] text-muted-foreground">Modified fields:</span>
                {detailData.translation.fieldDiff.changedFields.map((field: string) => (
                  <span
                    key={field}
                    className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-800 dark:text-amber-300 font-mono text-[10px] uppercase font-bold"
                  >
                    {field}
                  </span>
                ))}
              </div>
            )}

          {showDiff && (
            <div className="mt-2 p-3 bg-background/80 border border-border/80 rounded-lg text-xs font-mono space-y-1.5">
              <div className="text-muted-foreground">Source updated at: {sourceItem?.updatedAt}</div>
              <div className="text-foreground">Latest Title: {sourceItem?.title}</div>
              {sourceItem?.excerpt && <div className="text-foreground">Latest Excerpt: {sourceItem?.excerpt}</div>}
            </div>
          )}
        </div>
      )}

      {/* AI Translation Toolbar */}
      <div className="flex items-center justify-between p-3.5 bg-gradient-to-r from-purple-500/10 via-indigo-500/10 to-primary/10 border border-primary/20 rounded-xl shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-primary/20 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <span className="text-xs font-bold text-foreground">AI Translation Assistant</span>
            <p className="text-[11px] text-muted-foreground">
              Generates an editorial draft in <span className="font-semibold text-foreground">{targetMeta.native}</span> safely in 'Needs Review' status.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={aiProvider}
            onChange={(e) => setAiProvider(e.target.value)}
            className="h-8 px-2.5 bg-background border border-border rounded-lg text-xs text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="auto">Auto (Failover)</option>
            <option value="openai">OpenAI (GPT-4o)</option>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="gemini">Gemini</option>
          </select>
          <Button
            size="sm"
            onClick={() => aiMutation.mutate()}
            disabled={aiMutation.isPending}
            className="gap-1.5 h-8 text-xs cursor-pointer bg-primary text-primary-foreground font-semibold"
          >
            {aiMutation.isPending ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            <span>{aiMutation.isPending ? "Translating..." : "Translate Draft"}</span>
          </Button>
        </div>
      </div>

      {/* Mobile Tab Switcher */}
      <div className="flex md:hidden bg-muted p-1 rounded-xl border border-border">
        <button
          type="button"
          onClick={() => setActiveMobileTab("source")}
          className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
            activeMobileTab === "source"
              ? "bg-background text-foreground shadow-xs"
              : "text-muted-foreground"
          }`}
        >
          Source (English)
        </button>
        <button
          type="button"
          onClick={() => setActiveMobileTab("target")}
          className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
            activeMobileTab === "target"
              ? "bg-background text-foreground shadow-xs"
              : "text-muted-foreground"
          }`}
        >
          Target ({targetMeta.native})
        </button>
      </div>

      {/* Side-by-Side Workspace Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* Left Pane: Source Content (Read-Only) */}
        <div
          className={`space-y-4 ${
            activeMobileTab === "target" ? "hidden md:block" : "block"
          }`}
        >
          <Card className="border-border/60 bg-muted/20 shadow-xs">
            <CardHeader className="py-3 px-4 border-b border-border/40 bg-muted/40">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Source (English)
                  </CardTitle>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                  LTR • Read-Only
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-4 text-left" dir="ltr">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase">
                  Source Title
                </label>
                <div className="p-2.5 rounded-lg bg-background/60 border border-border/60 text-sm font-semibold text-foreground">
                  {sourceItem?.title || "Loading source title..."}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase">
                  Source Slug
                </label>
                <div className="p-2 rounded-lg bg-background/60 border border-border/60 text-xs font-mono text-muted-foreground">
                  /{sourceItem?.slug || "slug"}
                </div>
              </div>

              {sourceItem?.excerpt && (
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase">
                    Source Excerpt
                  </label>
                  <div className="p-2.5 rounded-lg bg-background/60 border border-border/60 text-xs text-muted-foreground">
                    {sourceItem.excerpt}
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase">
                  Source Content Body
                </label>
                <div className="p-3 rounded-lg bg-background/60 border border-border/60 text-xs text-foreground font-sans min-h-[220px] max-h-[400px] overflow-y-auto whitespace-pre-wrap">
                  {sourceItem?.content || "No body content."}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Pane: Target Translation (Editable) */}
        <div
          className={`space-y-4 ${
            activeMobileTab === "source" ? "hidden md:block" : "block"
          }`}
        >
          <Card className="border-border/80 bg-card shadow-xs">
            <CardHeader className="py-3 px-4 border-b border-border/40 bg-muted/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-primary" />
                  <CardTitle className="text-xs font-bold uppercase tracking-wider text-foreground">
                    Target Translation ({targetMeta.native})
                  </CardTitle>
                </div>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${
                    isTargetRtl
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {targetMeta.dir.toUpperCase()} • Editable
                </span>
              </div>
            </CardHeader>
            <CardContent
              className="p-4 space-y-4"
              dir={targetMeta.dir}
            >
              <div className="space-y-1.5">
                <label
                  htmlFor="target-title"
                  className="text-xs font-semibold text-foreground flex items-center justify-between"
                >
                  <span>Translated Title</span>
                  <span className="text-[10px] text-muted-foreground font-normal">
                    Required
                  </span>
                </label>
                <Input
                  id="target-title"
                  value={targetTitle}
                  onChange={(e) => setTargetTitle(e.target.value)}
                  placeholder={`Enter title in ${targetMeta.native}...`}
                  className="text-sm font-semibold"
                  dir={targetMeta.dir}
                  required
                />
              </div>

              <div className="space-y-1.5" dir="ltr">
                <label
                  htmlFor="target-slug"
                  className="text-xs font-semibold text-foreground flex items-center justify-between"
                >
                  <span>Localized Slug</span>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    /{targetLocale}/...
                  </span>
                </label>
                <Input
                  id="target-slug"
                  value={targetSlug}
                  onChange={(e) => setTargetSlug(e.target.value)}
                  placeholder="localized-slug"
                  className="text-xs font-mono"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="target-excerpt"
                  className="text-xs font-semibold text-foreground"
                >
                  Translated Excerpt / Summary
                </label>
                <textarea
                  id="target-excerpt"
                  value={targetExcerpt}
                  onChange={(e) => setTargetExcerpt(e.target.value)}
                  placeholder={`Enter brief summary in ${targetMeta.native}...`}
                  rows={2}
                  className="w-full p-2.5 bg-background border border-border rounded-lg text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  dir={targetMeta.dir}
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="target-body"
                  className="text-xs font-semibold text-foreground"
                >
                  Translated Content Body
                </label>
                <textarea
                  id="target-body"
                  value={targetBody}
                  onChange={(e) => setTargetBody(e.target.value)}
                  placeholder={`Write or paste translation body in ${targetMeta.native}...`}
                  rows={8}
                  className="w-full p-3 bg-background border border-border rounded-lg text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-sans"
                  dir={targetMeta.dir}
                />
              </div>

              {/* SEO Meta Fields */}
              <div className="pt-2 border-t border-border/40 space-y-3">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-primary" />
                  <span>SEO & Meta Configuration</span>
                </span>
                <div className="space-y-2">
                  <Input
                    value={metaTitle}
                    onChange={(e) => setMetaTitle(e.target.value)}
                    placeholder={`Meta Title (${targetMeta.native})`}
                    className="text-xs"
                    dir={targetMeta.dir}
                  />
                  <Input
                    value={metaDescription}
                    onChange={(e) => setMetaDescription(e.target.value)}
                    placeholder={`Meta Description (${targetMeta.native})`}
                    className="text-xs"
                    dir={targetMeta.dir}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};
