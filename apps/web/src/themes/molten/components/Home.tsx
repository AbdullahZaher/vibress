import { PreviewAnchor } from "../../../components/preview/PreviewAnchor";
import React from "react";
import { ThemeHomeProps } from "../../types";
import { ThemeLayout } from "./Layout";
import { PostCard } from "./PostCard";
import { t } from "../../../lib/i18n";

export async function Home(props: ThemeHomeProps) {
  const posts = props.posts || [];
  const hasExplicitFeatured = posts.some((post) => post.featured);

  return (
    <ThemeLayout
      settings={props.settings}
      site={props.site}
      bodyClass="home-template"
    >
      <div className="vb-outer">
        <main className="site-main vb-inner">
          <div className="post-feed vb-feed">
            {posts.map((post, index) => (
              <PostCard key={post.id} post={post} isFeatured={index === 0 && !hasExplicitFeatured} />
            ))}
          </div>

          {props.pagination.pages > 1 && (
            <nav
              className="pagination"
              style={{
                marginTop: "3.5rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              {props.pagination.page > 1 ? (
                <PreviewAnchor
                  href={`/?page=${props.pagination.page - 1}`}
                  className="newer-posts"
                >
                  &larr; {t("home.newer")}
                </PreviewAnchor>
              ) : (
                <span />
              )}
              <span className="page-number">
                {t("home.pageInfo", {
                  page: props.pagination.page,
                  pages: props.pagination.pages,
                })}
              </span>
              {props.pagination.page < props.pagination.pages ? (
                <PreviewAnchor
                  href={`/?page=${props.pagination.page + 1}`}
                  className="older-posts"
                >
                  {t("home.older")} &rarr;
                </PreviewAnchor>
              ) : (
                <span />
              )}
            </nav>
          )}
        </main>
      </div>
    </ThemeLayout>
  );
}
