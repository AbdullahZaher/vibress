import { useState } from "react";
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
}

export function CommentsPanel({
  comments,
  onError,
  onChanged,
}: CommentsPanelProps) {
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
    try {
      await approveCommentApi(id, reason);
      await onChanged();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to approve comment");
    }
  };

  const handleReject = async (id: string, reason?: string) => {
    try {
      await rejectCommentApi(id, reason);
      await onChanged();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to reject comment");
    }
  };

  const handleHide = async (id: string, reason?: string) => {
    try {
      await hideCommentApi(id, reason);
      await onChanged();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to hide comment");
    }
  };

  const handleRestore = async (id: string, reason?: string) => {
    try {
      await restoreCommentApi(id, reason);
      await onChanged();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to restore comment");
    }
  };

  const handleDelete = async (id: string, reason?: string) => {
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
    if (!reasonModal) return;
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
            Published
          </Badge>
        );
      case "pending_review":
        return (
          <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
            Pending Review
          </Badge>
        );
      case "hidden":
        return (
          <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20">
            Hidden
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20">
            Rejected
          </Badge>
        );
      case "deleted":
        return (
          <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20">
            Deleted
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
      <div className="flex items-center gap-1.5 flex-wrap">
        {["all", "pending_review", "published", "hidden", "rejected", "deleted"].map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => setStatusFilter(st)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              statusFilter === st
                ? "bg-primary text-primary-foreground font-semibold"
                : "bg-muted/60 text-muted-foreground hover:bg-muted"
            }`}
          >
            {st === "all" ? "All Statuses" : st.replace("_", " ")}
          </button>
        ))}
      </div>

      <Card className="bg-transparent border-border shadow-2xs p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className="ps-6 text-xs">Author / Member</TableHead>
              <TableHead className="text-xs">Comment Content</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-end pe-6 text-xs">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-32 text-center text-xs text-muted-foreground"
                >
                  No comments match the selected filter.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((c) => (
                <TableRow key={c.id} className="hover:bg-muted/40 border-border">
                  <TableCell className="ps-6 font-mono text-xs text-foreground">
                    <div className="flex flex-col">
                      <span className="font-semibold">{c.memberId || "Deleted Member"}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {new Date(c.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </TableCell>

                  <TableCell className="text-xs text-foreground max-w-md">
                    <p className="line-clamp-2">{c.body || <span className="italic text-muted-foreground">[Deleted]</span>}</p>
                  </TableCell>

                  <TableCell>{getStatusBadge(c.status)}</TableCell>

                  <TableCell className="text-end pe-6">
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      {c.status === "pending_review" && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleApprove(c.id)}
                            className="h-7 text-xs border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 gap-1"
                          >
                            <Check className="h-3 w-3" /> Approve
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setReasonModal({ commentId: c.id, action: "reject", title: "Reject Comment" })}
                            className="h-7 text-xs border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 gap-1"
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
                          className="h-7 text-xs border-border bg-card hover:bg-accent text-foreground gap-1"
                        >
                          <EyeOff className="h-3 w-3" /> Hide
                        </Button>
                      )}

                      {(c.status === "hidden" || c.status === "rejected") && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRestore(c.id)}
                          className="h-7 text-xs border-border bg-card hover:bg-accent text-foreground gap-1"
                        >
                          <RotateCcw className="h-3 w-3" /> Restore
                        </Button>
                      )}

                      {c.status !== "deleted" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setReasonModal({ commentId: c.id, action: "delete", title: "Delete Comment" })}
                          className="h-7 px-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenHistory(c)}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                        title="View Moderation History"
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
      </Card>

      {/* Moderation Reason Modal */}
      {reasonModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-lg max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-semibold text-foreground">{reasonModal.title}</h3>
            <p className="text-xs text-muted-foreground">
              Optionally provide a reason for this moderation action to record in the audit log.
            </p>
            <textarea
              value={moderationReason}
              onChange={(e) => setModerationReason(e.target.value)}
              placeholder="Reason (optional)..."
              rows={3}
              className="w-full text-xs p-2.5 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setReasonModal(null);
                  setModerationReason("");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={executeReasonAction}
              >
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Moderation Audit History Modal */}
      {historyModalComment && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-lg max-w-lg w-full p-6 shadow-xl space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" /> Moderation History
              </h3>
              <button
                type="button"
                onClick={() => setHistoryModalComment(null)}
                className="text-muted-foreground hover:text-foreground text-xs"
              >
                Close
              </button>
            </div>

            <div className="text-xs bg-muted/40 p-3 rounded-md border border-border font-mono">
              <p className="font-semibold text-foreground">Comment: {historyModalComment.id}</p>
              <p className="text-muted-foreground mt-1 truncate">"{historyModalComment.body}"</p>
            </div>

            {loadingHistory ? (
              <div className="py-8 text-center text-xs text-muted-foreground">Loading audit trail...</div>
            ) : historyEvents.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">No moderation events recorded yet.</div>
            ) : (
              <div className="space-y-3">
                {historyEvents.map((ev) => (
                  <div key={ev.id} className="text-xs p-3 rounded-md border border-border bg-card space-y-1">
                    <div className="flex items-center justify-between font-mono">
                      <span className="font-bold text-foreground capitalize">{ev.action}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(ev.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      <span>Status transition: </span>
                      <span className="font-mono">{ev.previousStatus}</span>
                      <span> → </span>
                      <span className="font-mono font-semibold text-foreground">{ev.newStatus}</span>
                    </div>
                    {ev.reason && (
                      <p className="text-[11px] text-foreground bg-muted/30 p-1.5 rounded">
                        <span className="font-semibold">Reason: </span>{ev.reason}
                      </p>
                    )}
                    <div className="text-[10px] text-muted-foreground font-mono">
                      Actor: {ev.actorType} ({ev.actorId})
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
