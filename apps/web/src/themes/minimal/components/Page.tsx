import React from 'react';
import { ThemePageProps } from '../../types';
import { ThemeLayout } from './Layout';

export async function Page(props: ThemePageProps) {
  const pageObj = props.page;

  return (
    <ThemeLayout settings={props.settings} site={props.site}>
      <main className="vb-main vb-outer">
        <article className="vb-article vb-inner">
          <header className="vb-article-header">
            <h1 className="vb-article-title">{pageObj.title}</h1>
            {pageObj.excerpt && <p className="vb-article-excerpt">{pageObj.excerpt}</p>}
            {pageObj.featureImage && (
              <figure className="vb-article-image">
                <img src={pageObj.featureImage.url} alt={pageObj.featureImage.alt || pageObj.title} />
              </figure>
            )}
          </header>

          <section className="vb-content studio-html-content">
            <div dangerouslySetInnerHTML={{ __html: pageObj.html || '' }} />
          </section>
        </article>
      </main>
    </ThemeLayout>
  );
}
