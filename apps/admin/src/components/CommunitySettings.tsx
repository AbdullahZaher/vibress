import { useEffect, useState, useCallback } from "react";
import {
  AdminComment,
  AdminCommentReport,
  listCommentsApi,
  listCommentReportsApi,
} from "../lib/api";

import { MessageSquare, ShieldAlert, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "./ui/button";
import { CommentsPanel } from "./community/CommentsPanel";
import { ReportsPanel } from "./community/ReportsPanel";

type Tab = "comments" | "reports";

export function CommunitySettings() {
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <MessageSquare className="h-5 w-5 text-primary" />
            Comments & Moderation
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Review reported member comments, manage public discussions, and enforce community standards.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading}
            className="h-8 px-3 text-xs gap-1.5 cursor-pointer border-border bg-card hover:bg-accent text-foreground"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

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

