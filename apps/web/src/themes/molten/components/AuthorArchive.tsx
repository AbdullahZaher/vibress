import React from 'react';
import { ThemeAuthorArchiveProps } from '../../types';
import { ThemeLayout } from './Layout';
import { PostCard } from './PostCard';

export async function AuthorArchive(props: ThemeAuthorArchiveProps) {
  const { author, posts, settings, site, pagination } = props;

  return (
    <ThemeLayout settings={settings} site={site} bodyClass="author-template">
      <main className="site-main">
        <header className="vb-page-head">
          <div className="vb-page-head-inner vb-inner">
            {(author as any).profileImage && (
              <img className="vb-page-head-image" src={(author as any).profileImage} alt={author.name} />
            )}
            <h1 className="vb-page-head-title">{author.name}</h1>
            <p className="vb-page-head-description">
              {author.bio || (
                <>
                  A collection of {pagination.total} {pagination.total === 1 ? 'post' : 'posts'}
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
            <nav className="pagination" style={{ marginTop: '3.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {pagination.page > 1 ? (
                <a href={`/author/${author.slug}?page=${pagination.page - 1}`} className="newer-posts">
                  &larr; Newer Posts
                </a>
              ) : (
                <span />
              )}
              <span className="page-number">
                Page {pagination.page} of {pagination.pages}
              </span>
              {pagination.page < pagination.pages ? (
                <a href={`/author/${author.slug}?page=${pagination.page + 1}`} className="older-posts">
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
