import { useState } from "react";
import { useAdminLocale } from "../../lib/admin-locale";
import {
  AdminComment,
  AdminModerationEvent,
  approveCommentApi,
  rejectCommentApi,
  hideCommentApi,
  restoreCommentApi,
  adminDeleteCommentApi,
  getCommentModerationHistoryApi,
} from "../../lib/api";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../ui/table";
import { History, Check, X, EyeOff, RotateCcw, Trash2, Clock } from "lucide-react";

interface CommentsPanelProps {
  comments: AdminComment[];
  onError: (message: string) => void;
  onChanged: () => Promise<void>;
  canModerate: boolean;
}

export function CommentsPanel({
  comments,
  onError,
  onChanged,
  canModerate,
}: CommentsPanelProps) {
  const { tr, formatDate } = useAdminLocale();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [historyModalComment, setHistoryModalComment] = useState<AdminComment | null>(null);
  const [historyEvents, setHistoryEvents] = useState<AdminModerationEvent[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [reasonModal, setReasonModal] = useState<{
    commentId: string;
    action: "approve" | "reject" | "hide" | "restore" | "delete";
    title: string;
  } | null>(null);
  const [moderationReason, setModerationReason] = useState("");

  const handleApprove = async (id: string, reason?: string) => {
    if (!canModerate) return;
    try {
      await approveCommentApi(id, reason);
      await onChanged();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to approve comment");
    }
  };

  const handleReject = async (id: string, reason?: string) => {
    if (!canModerate) return;
    try {
      await rejectCommentApi(id, reason);
      await onChanged();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to reject comment");
    }
  };

  const handleHide = async (id: string, reason?: string) => {
    if (!canModerate) return;
    try {
      await hideCommentApi(id, reason);
      await onChanged();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to hide comment");
    }
  };

  const handleRestore = async (id: string, reason?: string) => {
    if (!canModerate) return;
    try {
      await restoreCommentApi(id, reason);
      await onChanged();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to restore comment");
    }
  };

  const handleDelete = async (id: string, reason?: string) => {
    if (!canModerate) return;
    try {
      await adminDeleteCommentApi(id, reason);
      await onChanged();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to delete comment");
    }
  };

  const handleOpenHistory = async (c: AdminComment) => {
    setHistoryModalComment(c);
    setLoadingHistory(true);
    try {
      const res = await getCommentModerationHistoryApi(c.id);
      setHistoryEvents(res.events || []);
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoadingHistory(false);
    }
  };

  const executeReasonAction = async () => {
    if (!canModerate || !reasonModal) return;
    const { commentId, action } = reasonModal;
    const reason = moderationReason.trim() || undefined;

    setReasonModal(null);
    setModerationReason("");

    switch (action) {
      case "approve":
        await handleApprove(commentId, reason);
        break;
      case "reject":
        await handleReject(commentId, reason);
        break;
      case "hide":
        await handleHide(commentId, reason);
        break;
      case "restore":
        await handleRestore(commentId, reason);
        break;
      case "delete":
        await handleDelete(commentId, reason);
        break;
    }
  };

  const filtered = comments.filter((c) => {
    if (statusFilter === "all") return true;
    return c.status === statusFilter;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "published":
        return (
          <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
            {tr("Published")}
          </Badge>
        );
      case "pending_review":
        return (
          <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
            {tr("Pending Review")}
          </Badge>
        );
      case "hidden":
        return (
          <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20">
            {tr("Hidden")}
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20">
            {tr("Rejected")}
          </Badge>
        );
      case "deleted":
        return (
          <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20">
            {tr("Deleted")}
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5">
            {status}
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Status Filter Badges */}
      <div className="flex max-w-full flex-wrap items-center gap-1.5">
        {["all", "pending_review", "published", "hidden", "rejected", "deleted"].map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => setStatusFilter(st)}
            aria-pressed={statusFilter === st}
            className={`min-h-10 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              statusFilter === st
                ? "bg-primary text-primary-foreground font-semibold"
                : "bg-muted/60 text-muted-foreground hover:bg-muted"
            }`}
          >
            {st === "all" ? tr("All Statuses") : tr(st === "pending_review" ? "Pending Review" : st.charAt(0).toUpperCase() + st.slice(1))}
          </button>
        ))}
      </div>

      <Card className="bg-transparent border-border shadow-2xs p-0 overflow-hidden">
        <div className="overflow-x-auto">
        <Table className="min-w-[720px]">
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className="ps-6 text-xs">{tr("Author / Member")}</TableHead>
              <TableHead className="text-xs">{tr("Comment Content")}</TableHead>
              <TableHead className="text-xs">{tr("Status")}</TableHead>
              <TableHead className="text-end pe-6 text-xs">{tr("Actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-32 text-center text-xs text-muted-foreground"
                >
                  {tr("No comments match the selected filter.")}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((c) => (
                <TableRow key={c.id} className="hover:bg-muted/40 border-border">
                  <TableCell className="ps-6 font-mono text-xs text-foreground">
                    <div className="flex flex-col">
                      <span className="font-semibold">{c.memberId || tr("Deleted Member")}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {formatDate(c.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                      </span>
                    </div>
                  </TableCell>

                  <TableCell className="text-xs text-foreground max-w-md">
                    <p className="line-clamp-2">{c.body || <span className="italic text-muted-foreground">[{tr("Deleted")}]</span>}</p>
                  </TableCell>

                  <TableCell>{getStatusBadge(c.status)}</TableCell>

                  <TableCell className="text-end pe-6">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {canModerate && (
                        <>

                      {c.status === "pending_review" && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleApprove(c.id)}
                            className="min-h-10 text-sm border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 gap-1"
                          >
                            <Check className="h-3 w-3" /> Approve
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setReasonModal({ commentId: c.id, action: "reject", title: "Reject Comment" })}
                            className="min-h-10 text-sm border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 gap-1"
                          >
                            <X className="h-3 w-3" /> Reject
                          </Button>
                        </>
                      )}

                      {c.status === "published" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setReasonModal({ commentId: c.id, action: "hide", title: "Hide Comment" })}
                          className="min-h-10 text-sm border-border bg-card hover:bg-accent text-foreground gap-1"
                        >
                          <EyeOff className="h-3 w-3" /> Hide
                        </Button>
                      )}

                      {(c.status === "hidden" || c.status === "rejected") && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRestore(c.id)}
                          className="min-h-10 text-sm border-border bg-card hover:bg-accent text-foreground gap-1"
                        >
                          <RotateCcw className="h-3 w-3" /> Restore
                        </Button>
                      )}

                      {c.status !== "deleted" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setReasonModal({ commentId: c.id, action: "delete", title: "Delete Comment" })}
                          className="min-h-10 min-w-10 px-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}


                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenHistory(c)}
                        className="min-h-10 min-w-10 px-2 text-sm text-muted-foreground hover:text-foreground"
                        title={tr("View Moderation History")} aria-label={tr("View Moderation History")}
                      >
                        <History className="h-3 w-3" />
                      </Button>

                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </div>
      </Card>

      <Dialog
        isOpen={!!reasonModal}
        onClose={() => { setReasonModal(null); setModerationReason(""); }}
        title={reasonModal ? tr(reasonModal.title) : undefined}
        description={tr("Optionally provide a reason for this moderation action to record in the audit log.")}
        className="max-w-md"
      >
        <textarea
          value={moderationReason}
          onChange={(e) => setModerationReason(e.target.value)}
          placeholder={tr("Reason (optional)...")}
          rows={4}
          className="min-h-28 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        />
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" className="min-h-11" onClick={() => { setReasonModal(null); setModerationReason(""); }}>
            {tr("Cancel")}
          </Button>
          <Button className="min-h-11" onClick={() => void executeReasonAction()}>
            {tr("Confirm")}
          </Button>
        </div>
      </Dialog>

      <Dialog
        isOpen={!!historyModalComment}
        onClose={() => setHistoryModalComment(null)}
        title={tr("Moderation History")}
        className="max-w-2xl"
      >
        {historyModalComment && (
          <div className="max-h-[65vh] space-y-4 overflow-y-auto">
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="font-semibold text-foreground">{tr("Comment")}: {historyModalComment.id}</p>
              <p className="mt-1 truncate text-muted-foreground">{historyModalComment.body || tr("Deleted")}</p>
            </div>
            {loadingHistory ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{tr("Loading audit trail...")}</div>
            ) : historyEvents.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{tr("No moderation events recorded yet.")}</div>
            ) : (
              <div className="space-y-3">
                {historyEvents.map((event) => (
                  <div key={event.id} className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold capitalize text-foreground">{tr(event.action)}</span>
                      <time className="text-xs text-muted-foreground">{formatDate(event.createdAt, { dateStyle: "medium", timeStyle: "short" })}</time>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {tr("Status transition")}: <span className="font-mono">{tr(event.previousStatus)}</span> → <span className="font-mono font-semibold text-foreground">{tr(event.newStatus)}</span>
                    </p>
                    {event.reason && <p className="rounded-md bg-muted/30 p-2 text-xs text-foreground">{tr("Reason")}: {event.reason}</p>}
                    <p className="text-xs text-muted-foreground">{tr("Actor")}: {event.actorType} ({event.actorId})</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setHistoryModalComment(null)}>{tr("Close")}</Button>
        </div>
      </Dialog>
    </div>
  );
}
