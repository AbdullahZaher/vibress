import { getPreviewNavigation } from "../../../lib/preview-link-server";
import { rewritePreviewHtml } from "../../../lib/preview-links";
import { PreviewAnchor } from "../../../components/preview/PreviewAnchor";
import React from "react";
import { ThemePostProps } from "../../types";
import { ThemeLayout } from "./Layout";
import { CommentSection } from "../../../components/comments/CommentSection";
import { t } from "../../../lib/i18n";

export async function Post(props: ThemePostProps) {
  const { post, settings, site } = props;
  const primaryTag = post.tags?.[0];
  const authors =
    post.authors?.length > 0
      ? post.authors
      : [post.primaryAuthor].filter(Boolean);
  const authorNames = authors.map((a) => a?.name).join(", ");
  const dateLocale = site.locale || "en";

  const dateFormatted = new Date(post.publishedAt || new Date())
    .toLocaleDateString(dateLocale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
    .toUpperCase();

  const previewNavigation = await getPreviewNavigation();

  return (
    <ThemeLayout settings={settings} site={site} bodyClass="post-template">
      <main className="site-main">
        <article className={`vb-article post`}>
          <header className="vb-article-header vb-canvas">
            <span className="vb-article-meta">
              {t("home.by")} {authorNames}
              {primaryTag && (
                <>
                  {" "}
                  {t("post.in")}{" "}
                  <PreviewAnchor
                    className="vb-article-tag"
                    href={`/tag/${primaryTag.slug}`}
                  >
                    {primaryTag.name}
                  </PreviewAnchor>
                </>
              )}{" "}
              —{" "}
              <time dateTime={post.publishedAt?.substring(0, 10)}>
                {dateFormatted}
              </time>
              {site.commentsEnabled !== false && (
                <>
                  {" "}—{" "}
                  <PreviewAnchor
                    href="#comments-container"
                    className="vb-article-comments-badge"
                    style={{ textDecoration: "none", color: "inherit", fontWeight: 700 }}
                  >
                    💬 {post.commentCount ?? 0}
                  </PreviewAnchor>
                </>
              )}
            </span>

            <h1 className="vb-article-title">{post.title}</h1>

            {post.excerpt && (
              <p className="vb-article-excerpt">{post.excerpt}</p>
            )}
          </header>

          {post.featureImage?.url && (
            <figure className="vb-article-image vb-canvas">
              <img
                src={post.featureImage.url}
                alt={post.featureImage.alt || post.title}
                loading="eager"
              />
              {post.featureImage.caption && (
                <figcaption dangerouslySetInnerHTML={{ __html: post.featureImage.caption }} />
              )}
            </figure>
          )}

          <div
            className="vb-content vb-canvas studio-html-content"
            dangerouslySetInnerHTML={{ __html: rewritePreviewHtml(post.html || "", previewNavigation) }}
          />

          <CommentSection
            postId={post.id}
            postSlug={post.slug}
            initialCount={post.commentCount}
            commentsEnabled={site.commentsEnabled !== false}
            commentAccess={(site.comments?.commentAccess || site.commentAccess || "public") as any}
            locale={dateLocale}
            className="vb-canvas"
          />
        </article>

        <div className="vb-canvas">
          <div className="navigation">
            <div className="navigation-previous-wrapper">
              {/* Previous post placeholder */}
            </div>
            <div className="navigation-middle">
              <PreviewAnchor href="#" className="vb-button-share">
                {t("post.share")}
              </PreviewAnchor>
            </div>
            <div className="navigation-next-wrapper">
              {/* Next post placeholder */}
            </div>
          </div>
        </div>
      </main>
    </ThemeLayout>
  );
}
