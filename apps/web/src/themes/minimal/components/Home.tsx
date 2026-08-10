import React from 'react';
import { ThemeHomeProps, themeSetting } from '../../types';
import { ThemeLayout } from './Layout';

export async function Home(props: ThemeHomeProps) {
  const showPublicationDate = themeSetting(props.settings, 'showPublicationDate', true) as boolean;
  const showAuthor = themeSetting(props.settings, 'showAuthor', true) as boolean;

  return (
    <ThemeLayout settings={props.settings} site={props.site}>
      <main className="vb-main">
        <section className="vb-container vb-outer">
          <div className="vb-container-inner vb-inner">
            <h2 className="vb-container-title">Latest Writing</h2>

            {props.posts.length === 0 ? (
              <p style={{ opacity: 0.6, padding: '3rem 0' }}>No published posts yet.</p>
            ) : (
              <div className="vb-feed">
                {props.posts.map((post) => (
                  <article key={post.id} className="vb-card">
                    <a className="vb-card-link" href={`/posts/${post.slug}`}>
                      {post.featureImage && (
                        <figure className="vb-card-image">
                          <img
                            src={post.featureImage.url}
                            alt={post.featureImage.alt || post.title}
                            loading="lazy"
                          />
                        </figure>
                      )}
                      <div className="vb-card-wrapper">
                        {post.tags?.[0] && (
                          <span className="vb-article-tag" style={{ marginBottom: '0.4rem' }}>
                            {post.tags[0].name}
                          </span>
                        )}
                        <h2 className="vb-card-title">{post.title}</h2>
                        {post.excerpt && <p className="vb-card-excerpt">{post.excerpt}</p>}
                        <footer className="vb-card-meta">
                          {showAuthor && post.primaryAuthor && (
                            <span style={{ marginRight: '0.75rem' }}>{post.primaryAuthor.name}</span>
                          )}
                          {showPublicationDate && (
                            <time dateTime={post.publishedAt}>
                              {new Date(post.publishedAt).toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              })}
                            </time>
                          )}
                        </footer>
                      </div>
                    </a>
                  </article>
                ))}
              </div>
            )}

            {props.pagination.pages > 1 && (
              <div className="vb-more">
                {props.pagination.page < props.pagination.pages ? (
                  <a href={`/?page=${props.pagination.page + 1}`}>Older Articles &rarr;</a>
                ) : (
                  <a href={`/?page=${props.pagination.page - 1}`}>&larr; Newer Articles</a>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </ThemeLayout>
  );
}
