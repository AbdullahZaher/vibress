import React from 'react';
import { ThemePostProps, themeSetting } from '../../types';
import { ThemeLayout } from './Layout';

export async function Post(props: ThemePostProps) {
  const post = props.post;
  const showAuthor = themeSetting(props.settings, 'showAuthor', true) as boolean;
  const showPublicationDate = themeSetting(props.settings, 'showPublicationDate', true) as boolean;
  const showTags = themeSetting(props.settings, 'showTags', true) as boolean;

  const primaryTag = post.tags?.[0];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt || post.seo?.description,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': post.seo?.canonicalUrl,
    },
    author: post.authors?.map((a) => ({ '@type': 'Person', name: a.name })),
    ...(post.featureImage?.url ? { image: [post.featureImage.url] } : {}),
  };

  const text = (post.html || post.excerpt || '').replace(/<[^>]*>?/gm, '');
  const readTimeMins = Math.ceil(text.trim().split(/\s+/).filter(Boolean).length / 200) || 1;

  return (
    <ThemeLayout settings={props.settings} site={props.site}>
      <main id="site-main" className="site-main outer">
        <article className="article inner">
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
          />

          <header className="article-header">
            {showTags && primaryTag && (
              <div className="article-tag post-card-tags">
                <span className="post-card-primary-tag">
                  <a href={`/tags/${primaryTag.slug}`}>{primaryTag.name}</a>
                </span>
              </div>
            )}

            <h1 className="article-title">{post.title}</h1>

            {post.excerpt && <p className="article-excerpt">{post.excerpt}</p>}

            <div className="article-byline">
              <section className="article-byline-content">
                {showAuthor && post.primaryAuthor && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span className="author-avatar" style={{ width: 36, height: 36, fontSize: '0.9rem' }}>
                      {post.primaryAuthor.name.charAt(0).toUpperCase()}
                    </span>
                    <h4 className="author-name">
                      <a href={`/authors/${post.primaryAuthor.slug}`}>{post.primaryAuthor.name}</a>
                    </h4>
                  </div>
                )}
                <div className="byline-meta-content" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  {showPublicationDate && (
                    <time className="byline-meta-date" dateTime={post.publishedAt}>
                      {new Date(post.publishedAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </time>
                  )}
                  <span style={{ opacity: 0.4 }}>&bull;</span>
                  <span className="byline-meta-date">{readTimeMins} min read</span>
                </div>
              </section>
            </div>

            {post.featureImage && (
              <figure className="article-image">
                <img src={post.featureImage.url} alt={post.featureImage.alt || post.title} />
              </figure>
            )}
          </header>

          <section className="vb-content">
            <div dangerouslySetInnerHTML={{ __html: post.html || '' }} />
          </section>
        </article>
      </main>
    </ThemeLayout>
  );
}
