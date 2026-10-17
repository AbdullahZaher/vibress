import React from "react";
import { ThemeHomeProps, themeSetting } from "../../types";
import { ThemeLayout } from "./Layout";
import { InlineSubscribeForm } from "./InlineSubscribeForm";
import { SocialLinks } from "../../../components/SocialLinks";
import { t } from "../../../lib/i18n";

export async function Home(props: ThemeHomeProps) {
  const showPublicationCover = themeSetting(
    props.settings,
    "showPublicationCover",
    true,
  ) as boolean;
  const posts = props.posts || [];

  const heroHeadline = props.site.description || t("home.heroFallback");
  const dateLocale = props.site.locale || "en";

  return (
    <ThemeLayout settings={props.settings} site={props.site}>
      {/* Full-Bleed Hero Gradient Banner */}
      {showPublicationCover && (
        <section className="site-header-gradient outer">
          <div className="inner">
            <h1 className="site-header-gradient-title">{heroHeadline}</h1>
            <InlineSubscribeForm variant="hero" />
          </div>
        </section>
      )}

      {/* Main Content Feed (Horizontal Cards) */}
      <main id="site-main" className="site-main outer">
        <div className="inner">
          <div className="feed-section-header">{t("home.latest")}</div>

          {posts.length === 0 ? (
            <div style={{ padding: "4rem 0", opacity: 0.7 }}>
              <p>{t("home.empty")}</p>
            </div>
          ) : (
            <div className="post-feed-horizontal">
              {posts.map((post) => (
                <a
                  key={post.id}
                  href={`/posts/${post.slug}`}
                  className="post-card-horizontal"
                >
                  {post.featureImage ? (
                    <div className="post-card-horizontal-image-link">
                      <img
                        className="post-card-horizontal-image"
                        src={post.featureImage.url}
                        alt={post.title}
                        loading="lazy"
                      />
                    </div>
                  ) : (
                    <div
                      className="post-card-horizontal-image-link"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#94a3b8",
                        fontSize: "1.5rem",
                        fontWeight: 800,
                      }}
                    >
                      {post.title.charAt(0)}
                    </div>
                  )}

                  <div className="post-card-horizontal-content">
                    <h2 className="post-card-horizontal-title">{post.title}</h2>
                    {post.excerpt && (
                      <p className="post-card-horizontal-excerpt">
                        {post.excerpt}
                      </p>
                    )}
                    <div className="post-card-horizontal-meta">
                      {t("home.by")}{" "}
                      {post.primaryAuthor?.name || props.site.title} &mdash;{" "}
                      <time dateTime={post.publishedAt}>
                        {new Date(post.publishedAt).toLocaleDateString(
                          dateLocale,
                          {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          },
                        )}
                      </time>
                      {props.site.commentsEnabled !== false && typeof (post as any).commentCount === "number" && (
                        <>
                          {" "}&bull;{" "}
                          <span>
                            💬 {(post as any).commentCount}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}

          {props.pagination.pages > 1 && (
            <nav
              style={{
                marginTop: "3.5rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              {props.pagination.page > 1 ? (
                <a
                  href={`/?page=${props.pagination.page - 1}`}
                  style={{ fontWeight: 700, color: "var(--brand-pink)" }}
                >
                  &larr; {t("home.newer")}
                </a>
              ) : (
                <span />
              )}
              <span style={{ fontSize: "0.85rem", color: "#64748b" }}>
                {t("home.pageInfo", {
                  page: props.pagination.page,
                  pages: props.pagination.pages,
                })}
              </span>
              {props.pagination.page < props.pagination.pages ? (
                <a
                  href={`/?page=${props.pagination.page + 1}`}
                  style={{ fontWeight: 700, color: "var(--brand-pink)" }}
                >
                  {t("home.older")} &rarr;
                </a>
              ) : (
                <span />
              )}
            </nav>
          )}
        </div>
      </main>

      {/* Footer Newsletter & Social Section */}
      <section className="site-footer-newsletter outer">
        <div className="inner">
          <h2 className="footer-newsletter-title">{props.site.title}</h2>
          <p className="footer-newsletter-subtitle">{heroHeadline}</p>

          <InlineSubscribeForm variant="footer" />

          <SocialLinks
            links={props.site.socialLinks}
            locale={props.site.locale}
            className="footer-social-links"
          />
        </div>
      </section>
    </ThemeLayout>
  );
}
