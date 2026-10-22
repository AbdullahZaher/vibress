import { useEffect, useState, useCallback } from "react";
import {
  AdminComment,
  AdminCommentReport,
  listCommentsApi,
  listCommentReportsApi,
} from "../lib/api";

import { MessageSquare, ShieldAlert, RefreshCw, AlertCircle } from "lucide-react";
import { useAdminLocale } from "../lib/admin-locale";
import { Button } from "./ui/button";
import { IconButton } from "./ui/icon-button";
import { AdminPageHeader } from "./common/AdminPageHeader";
import { CommentsPanel } from "./community/CommentsPanel";
import { ReportsPanel } from "./community/ReportsPanel";

type Tab = "comments" | "reports";

export function CommunitySettings() {
  const { tr } = useAdminLocale();
  const [tab, setTab] = useState<Tab>("comments");
  const [comments, setComments] = useState<AdminComment[]>([]);
  const [reports, setReports] = useState<AdminCommentReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [c, r] = await Promise.all([
        listCommentsApi({ limit: 50 }),
        listCommentReportsApi({ limit: 50 }),
      ]);
      setComments(c.comments || []);
      setReports(r.reports || []);
      setError(null);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load comments and moderation data",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openReportsCount = reports.filter((r) => r.status === "open").length;

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto">
      {/* Header */}
      <AdminPageHeader
        title={tr("Comments & Moderation")}
        description={tr("Review reported member comments, manage public discussions, and enforce community standards.")}
        actions={
          <IconButton label={tr("Refresh")} variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          </IconButton>
        }
      />

      {/* Error Banner */}
      {error && (
        <div className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            className="h-6 px-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/20"
          >
            Retry
          </Button>
        </div>
      )}

      {/* Navigation Tabs Bar */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setTab("comments")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === "comments"
              ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          <span>Comments</span>
          <span className="ms-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-muted text-muted-foreground">
            {comments.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setTab("reports")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === "reports"
              ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ShieldAlert className="h-3.5 w-3.5" />
          <span>Reports</span>
          {openReportsCount > 0 ? (
            <span className="ms-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold">
              {openReportsCount}
            </span>
          ) : (
            <span className="ms-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-muted text-muted-foreground">
              {reports.length}
            </span>
          )}
        </button>
      </div>

      {/* Loading Skeleton */}
      {loading && comments.length === 0 && reports.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <RefreshCw className="h-5 w-5 animate-spin text-primary" />
          <p className="text-xs">Loading moderation queue...</p>
        </div>
      ) : (
        <>
          {/* Panels stay mounted so form state survives tab switches */}
          <div className={tab === "comments" ? "" : "hidden"}>
            <CommentsPanel
              comments={comments}
              onError={setError}
              onChanged={refresh}
            />
          </div>

          <div className={tab === "reports" ? "" : "hidden"}>
            <ReportsPanel
              reports={reports}
              onError={setError}
              onChanged={refresh}
            />
          </div>
        </>
      )}
    </div>
  );
}

