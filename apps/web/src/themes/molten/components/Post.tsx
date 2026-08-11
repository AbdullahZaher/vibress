import React from 'react';
import { ThemePostProps } from '../../types';
import { ThemeLayout } from './Layout';
import { PostCard } from './PostCard';
import { t } from '../../../lib/i18n';

export async function Post(props: ThemePostProps) {
  const { post, settings, site } = props;
  const primaryTag = post.tags?.[0];
  const authors = post.authors?.length > 0 ? post.authors : [post.primaryAuthor].filter(Boolean);
  const authorNames = authors.map(a => a?.name).join(', ');
  const dateLocale = site.locale || 'en';

  const dateFormatted = new Date(post.publishedAt || new Date()).toLocaleDateString(dateLocale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).toUpperCase();

  return (
    <ThemeLayout settings={settings} site={site} bodyClass="post-template">
      <main className="site-main">
        <article className={`vb-article post`}>
          <header className="vb-article-header vb-canvas">
            <span className="vb-article-meta">
              {t('home.by')} {authorNames} 
              {primaryTag && (
                <>
                  {' '}{t('post.in')} <a className="vb-article-tag" href={`/tag/${primaryTag.slug}`}>{primaryTag.name}</a>
                </>
              )}
              {' '}—{' '}
              <time dateTime={post.publishedAt?.substring(0, 10)}>{dateFormatted}</time>
            </span>

            <h1 className="vb-article-title">{post.title}</h1>

            {post.excerpt && (
              <p className="vb-article-excerpt">{post.excerpt}</p>
            )}

            {post.featureImage && (
              <figure className="vb-article-image vb-width-wide">
                <img
                  src={post.featureImage.url}
                  alt={post.title}
                />
              </figure>
            )}
          </header>

          <div className="vb-content vb-canvas studio-html-content" dangerouslySetInnerHTML={{ __html: post.html || '' }} />
        </article>

        <div className="vb-canvas">
          <div className="navigation">
            <div className="navigation-previous-wrapper">
              {/* Previous post placeholder */}
            </div>
            <div className="navigation-middle">
              <a href="#" className="vb-button-share">{t('post.share')}</a>
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
