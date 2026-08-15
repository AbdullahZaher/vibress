import React, { useState, useEffect } from "react";
import {
  MessageSquare,
  GitPullRequest,
  UserCheck,
  Check,
  X,
  Send,
  Clock,
  CheckCircle2,
  Users,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  EditorialComment,
  EditorialSuggestion,
  EditorialAssignment,
  PresenceUser,
  fetchEditorialComments,
  addEditorialComment,
  resolveEditorialComment,
  fetchEditorialSuggestions,
  reviewEditorialSuggestion,
  fetchEditorialAssignment,
  updateEditorialAssignment,
  sendPresenceHeartbeat,
} from "../../lib/api/collaboration";

interface EditorialCollaborationPanelProps {
  postId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const EditorialCollaborationPanel: React.FC<
  EditorialCollaborationPanelProps
> = ({ postId, isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<"comments" | "suggestions" | "assignment">("comments");
  const [comments, setComments] = useState<EditorialComment[]>([]);
  const [suggestions, setSuggestions] = useState<EditorialSuggestion[]>([]);
  const [assignment, setAssignment] = useState<EditorialAssignment | null>(null);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [newCommentText, setNewCommentText] = useState("");
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    try {
      const [c, s, a, p] = await Promise.all([
        fetchEditorialComments(postId),
        fetchEditorialSuggestions(postId),
        fetchEditorialAssignment(postId),
        sendPresenceHeartbeat(postId),
      ]);
      setComments(c);
      setSuggestions(s);
      setAssignment(a);
      setPresence(p);
    } catch (err) {
      console.error("Failed to load collaboration data:", err);
    }
  };

  useEffect(() => {
    if (!postId || !isOpen) return;
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [postId, isOpen]);

  const handleAddComment = async () => {
    if (!newCommentText.trim()) return;
    setLoading(true);
    try {
      const added = await addEditorialComment(postId, newCommentText.trim());
      setComments((prev) => [added, ...prev]);
      setNewCommentText("");
    } catch (err) {
      console.error("Failed to add comment:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleResolveComment = async (commentId: string) => {
    try {
      await resolveEditorialComment(postId, commentId);
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId ? { ...c, status: "resolved" as const } : c,
        ),
      );
    } catch (err) {
      console.error("Failed to resolve comment:", err);
    }
  };

  const handleReviewSuggestion = async (
    suggestionId: string,
    action: "accept" | "reject",
  ) => {
    try {
      await reviewEditorialSuggestion(postId, suggestionId, action);
      setSuggestions((prev) =>
        prev.map((s) =>
          s.id === suggestionId
            ? { ...s, status: action === "accept" ? "accepted" : "rejected" }
            : s,
        ),
      );
    } catch (err) {
      console.error(`Failed to ${action} suggestion:`, err);
    }
  };

  if (!isOpen) return null;

  return (
    <aside className="w-80 border-l bg-background flex flex-col h-full shadow-lg z-30">
      {/* Top Header */}
      <div className="flex items-center justify-between p-3.5 border-b">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Editorial Collaboration</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground p-1 rounded-md"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Active Presence Bar */}
      {presence.length > 0 && (
        <div className="px-3.5 py-2 bg-muted/30 border-b flex items-center gap-2 overflow-x-auto">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider shrink-0">
            Active:
          </span>
          <div className="flex items-center gap-1.5">
            {presence.map((u) => (
              <span
                key={u.userId}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {u.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex border-b text-xs font-medium">
        <button
          type="button"
          onClick={() => setActiveTab("comments")}
          className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
            activeTab === "comments"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Comments ({comments.filter((c) => c.status === "open").length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("suggestions")}
          className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
            activeTab === "suggestions"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <GitPullRequest className="h-3.5 w-3.5" />
          Suggestions ({suggestions.filter((s) => s.status === "pending").length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("assignment")}
          className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
            activeTab === "assignment"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <UserCheck className="h-3.5 w-3.5" />
          Assignment
        </button>
      </div>

      {/* Tab Contents */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
        {/* COMMENTS TAB */}
        {activeTab === "comments" && (
          <div className="flex flex-col h-full space-y-3">
            <div className="flex-1 overflow-y-auto space-y-2.5">
              {comments.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground">
                  No comments yet. Start a discussion with your team!
                </div>
              ) : (
                comments.map((comment) => (
                  <div
                    key={comment.id}
                    className={`p-2.5 rounded-lg border text-xs ${
                      comment.status === "resolved"
                        ? "bg-muted/30 border-muted opacity-60"
                        : "bg-background border-border shadow-sm"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-foreground">
                        {comment.authorName}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(comment.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-foreground leading-relaxed whitespace-pre-wrap mb-2">
                      {comment.body}
                    </p>
                    {comment.status === "open" && (
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleResolveComment(comment.id)}
                          className="h-6 text-[11px] px-2 gap-1 text-muted-foreground hover:text-foreground"
                        >
                          <Check className="h-3 w-3" /> Resolve
                        </Button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Add Comment Box */}
            <div className="border-t pt-2.5 flex items-center gap-2">
              <input
                type="text"
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleAddComment();
                  }
                }}
                placeholder="Write a comment..."
                className="flex-1 rounded-md border bg-background px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
              />
              <Button
                size="sm"
                disabled={loading || !newCommentText.trim()}
                onClick={handleAddComment}
                className="h-7 w-7 p-0 shrink-0"
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* SUGGESTIONS TAB */}
        {activeTab === "suggestions" && (
          <div className="space-y-3">
            {suggestions.length === 0 ? (
              <div className="text-center py-8 text-xs text-muted-foreground">
                No track change suggestions pending.
              </div>
            ) : (
              suggestions.map((sug) => (
                <div
                  key={sug.id}
                  className="p-3 rounded-lg border bg-background shadow-sm space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{sug.authorName}</span>
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded capitalize ${
                        sug.status === "accepted"
                          ? "bg-emerald-50 text-emerald-700"
                          : sug.status === "rejected"
                            ? "bg-rose-50 text-rose-700"
                            : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {sug.status}
                    </span>
                  </div>

                  {/* Diff View */}
                  <div className="space-y-1 bg-muted/40 p-2 rounded border font-mono text-[11px]">
                    <div className="line-through text-rose-600">
                      - {sug.originalText}
                    </div>
                    <div className="text-emerald-600 font-medium">
                      + {sug.suggestedText}
                    </div>
                  </div>

                  {sug.status === "pending" && (
                    <div className="flex items-center justify-end gap-1.5 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleReviewSuggestion(sug.id, "reject")}
                        className="h-6 text-[11px] px-2 gap-1 text-rose-600 hover:text-rose-700"
                      >
                        <X className="h-3 w-3" /> Reject
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleReviewSuggestion(sug.id, "accept")}
                        className="h-6 text-[11px] px-2 gap-1 bg-emerald-600 hover:bg-emerald-700"
                      >
                        <Check className="h-3 w-3" /> Accept
                      </Button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* ASSIGNMENT TAB */}
        {activeTab === "assignment" && (
          <div className="space-y-4 text-xs">
            <div className="p-3 rounded-lg border bg-background shadow-sm space-y-3">
              <div>
                <span className="text-muted-foreground block text-[11px] mb-1 font-medium">
                  Review Status
                </span>
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary capitalize">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {assignment?.reviewStatus || "pending"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      const updated = await updateEditorialAssignment(postId, {
                        reviewStatus: "in_review",
                      });
                      setAssignment(updated);
                    }}
                    className="h-6 text-[10px]"
                  >
                    Request Review
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      const updated = await updateEditorialAssignment(postId, {
                        reviewStatus: "changes_requested",
                      });
                      setAssignment(updated);
                    }}
                    className="h-6 text-[10px]"
                  >
                    Request Changes
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={async () => {
                      const updated = await updateEditorialAssignment(postId, {
                        reviewStatus: "approved",
                      });
                      setAssignment(updated);
                    }}
                    className="h-6 text-[10px] col-span-2 bg-emerald-600 hover:bg-emerald-700"
                  >
                    Approve Content
                  </Button>
                </div>
              </div>

              {assignment?.assigneeName && (
                <div>
                  <span className="text-muted-foreground block text-[11px] mb-1 font-medium">
                    Primary Assignee
                  </span>
                  <span className="font-semibold text-foreground">
                    {assignment.assigneeName}
                  </span>
                </div>
              )}

              {assignment?.dueDate && (
                <div>
                  <span className="text-muted-foreground block text-[11px] mb-1 font-medium">
                    Due Date
                  </span>
                  <span className="inline-flex items-center gap-1 text-foreground">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    {new Date(assignment.dueDate).toLocaleDateString()}
                  </span>
                </div>
              )}

              {assignment?.editorialNotes && (
                <div>
                  <span className="text-muted-foreground block text-[11px] mb-1 font-medium">
                    Editorial Notes
                  </span>
                  <p className="text-muted-foreground leading-relaxed bg-muted/40 p-2 rounded">
                    {assignment.editorialNotes}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
