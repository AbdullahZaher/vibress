import React from 'react';
import { ThemePostProps, themeSetting } from '../../types';
import { ThemeLayout } from './Layout';

export async function Post(props: ThemePostProps) {
  const post = props.post;
  const showPublicationDate = themeSetting(props.settings, 'showPublicationDate', true) as boolean;
  const showAuthor = themeSetting(props.settings, 'showAuthor', true) as boolean;
  const dateLocale = props.site.locale || 'en';

  return (
    <ThemeLayout settings={props.settings} site={props.site}>
      <main className="vb-main vb-outer">
        <article className="vb-article vb-inner">
          <header className="vb-article-header">
            {post.tags?.[0] && <span className="vb-article-tag">{post.tags[0].name}</span>}
            
            <h1 className="vb-article-title gh-article-title">{post.title}</h1>
            
            {post.excerpt && <p className="vb-article-excerpt">{post.excerpt}</p>}

            <div className="vb-meta-share">
              {showAuthor && post.primaryAuthor && (
                <div className="vb-article-author-name">{post.primaryAuthor.name}</div>
              )}
              {showPublicationDate && (
                <time className="vb-article-meta-date" dateTime={post.publishedAt}>
                  {new Date(post.publishedAt).toLocaleDateString(dateLocale, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </time>
              )}
            </div>

            {post.featureImage && (
              <figure className="vb-article-image">
                <img src={post.featureImage.url} alt={post.featureImage.alt || post.title} />
              </figure>
            )}
          </header>

          <section className="vb-content studio-html-content">
            <div dangerouslySetInnerHTML={{ __html: post.html || '' }} />
          </section>
        </article>
      </main>
    </ThemeLayout>
  );
}
