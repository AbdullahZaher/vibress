import React from "react";
import { ThemePageProps } from "../../types";
import { ThemeLayout } from "./Layout";
import { CodeCopyHandler } from "../../../components/reader/CodeCopyHandler";
import { ImageLightbox } from "../../../components/reader/ImageLightbox";

export async function Page(props: ThemePageProps) {
  const pageObj = props.page;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: pageObj.title,
    description: pageObj.excerpt || pageObj.seo?.description,
    url: pageObj.seo?.canonicalUrl,
    datePublished: pageObj.publishedAt,
    dateModified: pageObj.updatedAt,
  };

  return (
    <ThemeLayout settings={props.settings} site={props.site}>
      <CodeCopyHandler />
      <ImageLightbox />

      <main id="site-main" className="site-main outer">
        <article className="article inner">
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
            }}
          />

          <header className="article-header">
            <h1 className="article-title">{pageObj.title}</h1>
            {pageObj.excerpt && (
              <p className="article-excerpt">{pageObj.excerpt}</p>
            )}
          </header>

          <section className="vb-content studio-html-content">
            <div dangerouslySetInnerHTML={{ __html: pageObj.html || "" }} />
          </section>
        </article>
      </main>
    </ThemeLayout>
  );
}
