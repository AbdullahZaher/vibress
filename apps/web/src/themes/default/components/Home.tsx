import React from "react";
import { ThemeHomeProps, themeSetting } from "../../types";
import { ThemeLayout } from "./Layout";
import { InlineSubscribeForm } from "./InlineSubscribeForm";
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

          <div className="footer-social-links">
            <a
              href="https://x.com"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-social-btn"
              aria-label="X (Twitter)"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <a
              href="https://facebook.com"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-social-btn"
              aria-label="Facebook"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
            </a>
          </div>
        </div>
      </section>
    </ThemeLayout>
  );
}
