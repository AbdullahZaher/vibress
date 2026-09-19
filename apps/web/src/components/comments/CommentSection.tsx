"use client";

import React, { useState, useEffect, useCallback, useId } from "react";
import type { PublicCommentDTO } from "@vibress/api-contracts";
import { t } from "../../lib/i18n";

export interface CommentSectionProps {
  postId: string;
  postSlug?: string | undefined;
  initialComments?: PublicCommentDTO[] | undefined;
  initialCount?: number | undefined;
  commentsEnabled?: boolean | undefined;
  commentAccess?: "public" | "members_only" | "disabled" | string | undefined;
  isMemberAuthenticated?: boolean | undefined;
  currentMemberId?: string | undefined;
  currentMemberName?: string | undefined;
  locale?: string | undefined;
  className?: string | undefined;
}

interface ThreadedComment extends PublicCommentDTO {
  children?: ThreadedComment[];
}

function buildCommentTree(comments: PublicCommentDTO[]): ThreadedComment[] {
  const map = new Map<string, ThreadedComment>();
  const roots: ThreadedComment[] = [];

  for (const c of comments) {
    map.set(c.id, { ...c, children: [] });
  }

  for (const c of comments) {
    const node = map.get(c.id)!;
    if (c.parentId && map.has(c.parentId)) {
      map.get(c.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function CommentSection({
  postId,
  postSlug,
  initialComments = [],
  initialCount = 0,
  commentsEnabled = true,
  commentAccess = "public",
  isMemberAuthenticated = false,
  currentMemberId,
  currentMemberName,
  locale = "en",
  className = "",
}: CommentSectionProps) {
  const [comments, setComments] = useState<PublicCommentDTO[]>(initialComments);
  const [totalCount, setTotalCount] = useState<number>(initialCount);
  const [isLoading, setIsLoading] = useState<boolean>(initialComments.length === 0);
  const [newCommentBody, setNewCommentBody] = useState<string>("");
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState<string>("");
  const [reportingCommentId, setReportingCommentId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState<string>("spam");
  const [reportDetails, setReportDetails] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  const isRtl = locale.startsWith("ar");
  const inputId = useId();

  const fetchComments = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch(`/api/content/v1/posts/${postId}/comments?limit=100`);
      if (res.ok) {
        const data = await res.json();
        const items = data.comments || data.items || [];
        if (Array.isArray(items)) {
          setComments(items);
          setTotalCount(data.total ?? items.length);
        }
      }
    } catch {
      // Gracefully handle network errors
    } finally {
      setIsLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    if (initialComments.length === 0 && commentsEnabled && commentAccess !== "disabled") {
      fetchComments();
    }
  }, [fetchComments, initialComments.length, commentsEnabled, commentAccess]);

  if (!commentsEnabled || commentAccess === "disabled") {
    return null;
  }

  const handleSubmitComment = async (parentId: string | null = null) => {
    const body = parentId ? replyBody.trim() : newCommentBody.trim();
    if (!body || isSubmitting) return;

    setIsSubmitting(true);
    setFeedbackMessage(null);

    const clientCommentId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      const res = await fetch(`/api/members/v1/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-idempotency-key": clientCommentId,
        },
        body: JSON.stringify({
          postId,
          body,
          parentId,
          clientCommentId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const created: PublicCommentDTO = data.comment || data;
        if (created.status === "pending_review") {
          setFeedbackMessage({
            type: "info",
            text: t("comments.pendingApproval", undefined, locale),
          });
        } else {
          setComments((prev) => [...prev, created]);
          setTotalCount((prev) => prev + 1);
        }

        if (parentId) {
          setReplyingToId(null);
          setReplyBody("");
        } else {
          setNewCommentBody("");
        }
      } else if (res.status === 401) {
        setFeedbackMessage({
          type: "error",
          text: t("comments.signInToComment", undefined, locale),
        });
      } else {
        const err = await res.json().catch(() => ({}));
        setFeedbackMessage({
          type: "error",
          text: err.message || t("common.error", undefined, locale),
        });
      }
    } catch {
      setFeedbackMessage({
        type: "error",
        text: t("common.error", undefined, locale),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleLike = async (commentId: string, currentLiked: boolean) => {
    // Optimistic UI update
    setComments((prev) =>
      prev.map((c) => {
        if (c.id === commentId) {
          return {
            ...c,
            hasLiked: !currentLiked,
            likeCount: currentLiked ? Math.max(0, c.likeCount - 1) : c.likeCount + 1,
          };
        }
        return c;
      }),
    );

    try {
      const res = await fetch(`/api/members/v1/comments/${commentId}/like`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setComments((prev) =>
          prev.map((c) =>
            c.id === commentId
              ? {
                  ...c,
                  likeCount: data.likeCount ?? (data.liked ? c.likeCount + 1 : Math.max(0, c.likeCount - 1)),
                  hasLiked: data.liked ?? !currentLiked,
                }
              : c,
          ),
        );
      } else {
        // Rollback on failure
        setComments((prev) =>
          prev.map((c) => {
            if (c.id === commentId) {
              return {
                ...c,
                hasLiked: currentLiked,
                likeCount: currentLiked ? c.likeCount + 1 : Math.max(0, c.likeCount - 1),
              };
            }
            return c;
          }),
        );
      }
    } catch {
      // Rollback on network error
      setComments((prev) =>
        prev.map((c) => {
          if (c.id === commentId) {
            return {
              ...c,
              hasLiked: currentLiked,
              likeCount: currentLiked ? c.likeCount + 1 : Math.max(0, c.likeCount - 1),
            };
          }
          return c;
        }),
      );
    }
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportingCommentId || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/members/v1/comments/${reportingCommentId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reportReason,
          notes: reportDetails.trim() || undefined,
        }),
      });

      if (res.ok) {
        setFeedbackMessage({
          type: "success",
          text: t("comments.reportSuccess", undefined, locale),
        });
        setReportingCommentId(null);
        setReportDetails("");
      } else {
        const err = await res.json().catch(() => ({}));
        setFeedbackMessage({
          type: "error",
          text: err.message || t("common.error", undefined, locale),
        });
      }
    } catch {
      setFeedbackMessage({
        type: "error",
        text: t("common.error", undefined, locale),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const tree = buildCommentTree(comments);

  const renderCommentNode = (comment: ThreadedComment, depth = 0) => {
    const isReplying = replyingToId === comment.id;
    const isDeleted = comment.isDeleted;

    return (
      <li
        key={comment.id}
        className={`vb-comment-item ${isDeleted ? "is-deleted" : ""}`}
        style={{
          marginLeft: isRtl ? 0 : `${Math.min(depth, 3) * 1.5}rem`,
          marginRight: isRtl ? `${Math.min(depth, 3) * 1.5}rem` : 0,
        }}
        id={`comment-${comment.id}`}
      >
        <div className="vb-comment-card">
          <div className="vb-comment-header">
            <div className="vb-comment-avatar">
              {comment.author.avatarUrl ? (
                <img src={comment.author.avatarUrl} alt={comment.author.name} />
              ) : (
                <span>{comment.author.name ? comment.author.name.charAt(0).toUpperCase() : "A"}</span>
              )}
            </div>
            <div className="vb-comment-meta">
              <span className="vb-comment-author-name">{comment.author.name || "Anonymous"}</span>
              <time className="vb-comment-date" dateTime={comment.createdAt}>
                {new Date(comment.createdAt).toLocaleDateString(locale, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </time>
            </div>
          </div>

          <div className="vb-comment-body">
            {isDeleted ? (
              <p className="vb-comment-deleted-text">{t("comments.deleted", undefined, locale)}</p>
            ) : (
              <p>{comment.body}</p>
            )}
          </div>

          {!isDeleted && (
            <div className="vb-comment-actions">
              <button
                type="button"
                className={`vb-comment-btn vb-comment-like-btn ${comment.hasLiked ? "is-liked" : ""}`}
                onClick={() => handleToggleLike(comment.id, !!comment.hasLiked)}
                aria-label={comment.hasLiked ? t("comments.unlike", undefined, locale) : t("comments.like", undefined, locale)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill={comment.hasLiked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
                <span>{comment.likeCount > 0 ? comment.likeCount : ""}</span>
              </button>

              <button
                type="button"
                className="vb-comment-btn vb-comment-reply-btn"
                onClick={() => setReplyingToId(isReplying ? null : comment.id)}
                aria-expanded={isReplying}
              >
                {t("comments.reply", undefined, locale)}
              </button>

              <button
                type="button"
                className="vb-comment-btn vb-comment-report-btn"
                onClick={() => setReportingCommentId(comment.id)}
                aria-label={t("comments.report", undefined, locale)}
              >
                {t("comments.report", undefined, locale)}
              </button>
            </div>
          )}

          {isReplying && (
            <div className="vb-comment-reply-form">
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder={t("comments.replyTo", { name: comment.author.name }, locale)}
                rows={2}
                maxLength={5000}
                aria-label={t("comments.reply", undefined, locale)}
              />
              <div className="vb-comment-reply-actions">
                <button
                  type="button"
                  className="vb-btn vb-btn-sm vb-btn-secondary"
                  onClick={() => {
                    setReplyingToId(null);
                    setReplyBody("");
                  }}
                >
                  {t("comments.cancel", undefined, locale)}
                </button>
                <button
                  type="button"
                  className="vb-btn vb-btn-sm vb-btn-primary"
                  disabled={!replyBody.trim() || isSubmitting}
                  onClick={() => handleSubmitComment(comment.id)}
                >
                  {isSubmitting ? t("comments.submitting", undefined, locale) : t("comments.submit", undefined, locale)}
                </button>
              </div>
            </div>
          )}
        </div>

        {comment.children && comment.children.length > 0 && (
          <ul className="vb-comments-replies" role="group">
            {comment.children.map((child) => renderCommentNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <section
      className={`vb-comments-section ${className}`}
      id="comments-container"
      aria-label={t("comments.title", undefined, locale)}
      dir={isRtl ? "rtl" : "ltr"}
    >
      <div className="vb-comments-header">
        <h2 className="vb-comments-title">
          {t("comments.title", undefined, locale)}
          <span className="vb-comments-count-badge">({totalCount})</span>
        </h2>
      </div>

      {feedbackMessage && (
        <div
          className={`vb-comments-alert vb-comments-alert-${feedbackMessage.type}`}
          role="alert"
          aria-live="polite"
        >
          {feedbackMessage.text}
        </div>
      )}

      {/* Main Comment Input Form */}
      <div className="vb-comment-composer">
        <label htmlFor={inputId} className="vb-sr-only">
          {t("comments.leaveComment", undefined, locale)}
        </label>
        <textarea
          id={inputId}
          value={newCommentBody}
          onChange={(e) => setNewCommentBody(e.target.value)}
          placeholder={t("comments.leaveComment", undefined, locale)}
          rows={3}
          maxLength={5000}
        />
        <div className="vb-composer-footer">
          <span className="vb-char-counter">
            {newCommentBody.length}/5000
          </span>
          <button
            type="button"
            className="vb-btn vb-btn-primary"
            disabled={!newCommentBody.trim() || isSubmitting}
            onClick={() => handleSubmitComment(null)}
          >
            {isSubmitting ? t("comments.submitting", undefined, locale) : t("comments.submit", undefined, locale)}
          </button>
        </div>
      </div>

      {/* Comments List */}
      {isLoading ? (
        <div className="vb-comments-loading" aria-live="polite">
          <p>{t("common.loading", undefined, locale)}</p>
        </div>
      ) : tree.length === 0 ? (
        <div className="vb-comments-empty">
          <p>{t("comments.beFirst", undefined, locale)}</p>
        </div>
      ) : (
        <ul className="vb-comments-list" role="feed" aria-busy={isLoading}>
          {tree.map((c) => renderCommentNode(c, 0))}
        </ul>
      )}

      {/* Report Modal */}
      {reportingCommentId && (
        <div className="vb-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="report-dialog-title">
          <div className="vb-modal-box">
            <h3 id="report-dialog-title">{t("comments.report", undefined, locale)}</h3>
            <form onSubmit={handleReportSubmit}>
              <div className="vb-form-group">
                <label>{t("comments.reportReason", undefined, locale)}</label>
                <select
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  className="vb-select"
                >
                  <option value="spam">{t("comments.reportReasonSpam", undefined, locale)}</option>
                  <option value="harassment">{t("comments.reportReasonHarassment", undefined, locale)}</option>
                  <option value="hate_speech">{t("comments.reportReasonHateSpeech", undefined, locale)}</option>
                  <option value="inappropriate">{t("comments.reportReasonInappropriate", undefined, locale)}</option>
                  <option value="off_topic">{t("comments.reportReasonOffTopic", undefined, locale)}</option>
                  <option value="other">{t("comments.reportReasonOther", undefined, locale)}</option>
                </select>
              </div>

              <div className="vb-form-group">
                <textarea
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  placeholder="Additional details (optional)..."
                  rows={2}
                  maxLength={1000}
                />
              </div>

              <div className="vb-modal-actions">
                <button
                  type="button"
                  className="vb-btn vb-btn-secondary"
                  onClick={() => setReportingCommentId(null)}
                >
                  {t("comments.cancel", undefined, locale)}
                </button>
                <button
                  type="submit"
                  className="vb-btn vb-btn-danger"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? t("comments.submitting", undefined, locale) : t("comments.reportSubmit", undefined, locale)}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
