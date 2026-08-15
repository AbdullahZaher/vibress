import React from "react";
import { t } from "../../../lib/i18n";
import type { PublicPostSummaryDto } from "@vibress/api-contracts";

interface PostCardProps {
  post: PublicPostSummaryDto;
  isFeatured?: boolean;
}

export function PostCard({ post, isFeatured = false }: PostCardProps) {
  const primaryTag = post.tags?.[0] as
    { accentColor?: string; name?: string } | undefined;
  const authors = [
    (post as { primaryAuthor?: { profileImage?: string; name?: string } })
      .primaryAuthor,
  ].filter(Boolean);

  const isActuallyFeatured =
    isFeatured || (post as { featured?: boolean }).featured;
  const postClass = `post ${isActuallyFeatured ? "featured" : ""}`;

  // Use post.featureImage or fallback to a default thumbnail
  const imageUrl =
    post.featureImage?.url ||
    "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop";

  return (
    <article
      className={`${postClass} u-shadow`}
      style={
        primaryTag?.accentColor
          ? ({ "--tag-color": primaryTag.accentColor } as React.CSSProperties)
          : {}
      }
    >
      <a className="post-link" href={`/posts/${post.slug}`}>
        {isActuallyFeatured ? (
          <img
            className="post-image u-object-fit"
            src={imageUrl}
            alt={post.title}
            loading="lazy"
          />
        ) : (
          <figure className="post-media">
            <div className="u-placeholder same-height rectangle">
              <img
                className="post-image u-object-fit"
                src={imageUrl}
                alt={post.title}
                loading="lazy"
              />
            </div>
          </figure>
        )}

        <div className="post-wrapper">
          <header className="post-header">
            {primaryTag && <span className="post-tag">{primaryTag.name}</span>}

            <h2 className="post-title">{post.title}</h2>
          </header>

          {post.excerpt && <div className="post-excerpt">{post.excerpt}</div>}
        </div>

        <footer className="post-footer">
          <span className="post-more">{t("post.readMore")}</span>

          <div className="post-author">
            {authors.map((author, i) => {
              const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(author?.name || "A")}&background=random&color=fff&size=128`;
              return (
                <span key={i} className="post-author-link">
                  <img
                    className="post-author-image"
                    src={author?.profileImage || fallbackAvatar}
                    alt={author?.name}
                    loading="lazy"
                  />
                </span>
              );
            })}
          </div>
        </footer>
      </a>
    </article>
  );
}
