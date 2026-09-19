"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CommentSection } from "./CommentSection";

export interface LiquidCommentsHydratorProps {
  postId: string;
  postSlug?: string | undefined;
  initialCount?: number | undefined;
  commentsEnabled?: boolean | undefined;
  commentAccess?: string | undefined;
  locale?: string | undefined;
}

export function LiquidCommentsHydrator({
  postId,
  postSlug,
  initialCount = 0,
  commentsEnabled = true,
  commentAccess = "public",
  locale = "en",
}: LiquidCommentsHydratorProps) {
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Locate the mount container rendered by Liquid {% comments %} tag
    const el = document.getElementById("vb-comments-root");
    if (el) {
      setMountNode(el);
    }
  }, []);

  if (!mountNode || !commentsEnabled || commentAccess === "disabled") {
    return null;
  }

  // Extract attributes from the DOM element if available
  const effectivePostId = mountNode.getAttribute("data-post-id") || postId;
  const effectiveSlug = mountNode.getAttribute("data-post-slug") || postSlug;
  const dataCount = mountNode.getAttribute("data-comment-count");
  const effectiveCount = dataCount !== null ? parseInt(dataCount, 10) || 0 : initialCount;
  const effectiveAccess = mountNode.getAttribute("data-access") || commentAccess;

  return createPortal(
    <CommentSection
      postId={effectivePostId}
      postSlug={effectiveSlug}
      initialCount={effectiveCount}
      commentsEnabled={commentsEnabled}
      commentAccess={effectiveAccess as any}
      locale={locale}
    />,
    mountNode,
  );
}
