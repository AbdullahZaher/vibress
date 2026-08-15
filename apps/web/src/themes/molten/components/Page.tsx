import React from "react";
import { ThemePageProps } from "../../types";
import { ThemeLayout } from "./Layout";

export async function Page(props: ThemePageProps) {
  const { page, settings, site } = props;

  return (
    <ThemeLayout settings={settings} site={site} bodyClass="page-template">
      <main className="site-main">
        <article className={`vb-article page`}>
          {/* In a complete implementation we might check @page.show_title_and_feature_image setting, but assuming true by default for now */}
          <header className="vb-article-header vb-canvas">
            <h1 className="vb-article-title">{page.title}</h1>

            {page.excerpt && (
              <p className="vb-article-excerpt">{page.excerpt}</p>
            )}
          </header>

          <div
            className="vb-content vb-canvas studio-html-content"
            dangerouslySetInnerHTML={{ __html: page.html || "" }}
          />
        </article>
      </main>
    </ThemeLayout>
  );
}
