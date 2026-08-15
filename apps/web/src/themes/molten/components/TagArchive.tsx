import React from "react";
import { ThemeTagArchiveProps } from "../../types";
import { ThemeLayout } from "./Layout";
import { PostCard } from "./PostCard";

export async function TagArchive(props: ThemeTagArchiveProps) {
  const { tag, posts, settings, site, pagination } = props;

  return (
    <ThemeLayout settings={settings} site={site} bodyClass="tag-template">
      <main className="site-main">
        <header className="vb-page-head">
          <div className="vb-page-head-inner vb-inner">
            <h1 className="vb-page-head-title">{tag.name}</h1>
            <p className="vb-page-head-description">
              {tag.description || (
                <>
                  A collection of {pagination.total}{" "}
                  {pagination.total === 1 ? "post" : "posts"}
                </>
              )}
            </p>
          </div>
        </header>

        <div className="vb-outer">
          <div className="post-feed vb-feed vb-inner">
            {posts?.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>

          {pagination.pages > 1 && (
            <nav
              className="pagination"
              style={{
                marginTop: "3.5rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              {pagination.page > 1 ? (
                <a
                  href={`/tag/${tag.slug}?page=${pagination.page - 1}`}
                  className="newer-posts"
                >
                  &larr; Newer Posts
                </a>
              ) : (
                <span />
              )}
              <span className="page-number">
                Page {pagination.page} of {pagination.pages}
              </span>
              {pagination.page < pagination.pages ? (
                <a
                  href={`/tag/${tag.slug}?page=${pagination.page + 1}`}
                  className="older-posts"
                >
                  Older Posts &rarr;
                </a>
              ) : (
                <span />
              )}
            </nav>
          )}
        </div>
      </main>
    </ThemeLayout>
  );
}
