import React from "react";
import { ThemePageProps } from "../../types";
import { ThemeLayout } from "./Layout";
import { CodeCopyHandler } from "../../../components/reader/CodeCopyHandler";
import { ImageLightbox } from "../../../components/reader/ImageLightbox";
import { buildPageJsonLd, safeJsonLdScript } from "../../../lib/seo-helpers";

export async function Page(props: ThemePageProps) {
  const pageObj = props.page;
  const jsonLd = buildPageJsonLd(pageObj, props.site.locale, {
    primaryLocale: props.site.primaryLocale,
    enabledLocales: props.site.enabledLocales,
  });

  return (
    <ThemeLayout settings={props.settings} site={props.site}>
      <CodeCopyHandler />
      <ImageLightbox />

      <main id="site-main" className="site-main outer">
        <article className="article inner">
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: safeJsonLdScript(jsonLd),
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
