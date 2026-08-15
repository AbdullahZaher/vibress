import { ThemeAuthorArchiveProps, themeSetting } from "../../types";
import { ThemeLayout } from "./Layout";
import { t } from "../../../lib/i18n";

export async function AuthorArchive(props: ThemeAuthorArchiveProps) {
  const { author, posts } = props;
  const showPublicationDate = themeSetting(
    props.settings,
    "showPublicationDate",
    true,
  ) as boolean;
  const dateLocale = props.site.locale || "en";

  return (
    <ThemeLayout settings={props.settings} site={props.site}>
      <main>
        <h1 className="minimal-page-title">{author.name}</h1>
        {author.bio && <p className="minimal-empty">{author.bio}</p>}

        {posts.length === 0 ? (
          <p className="minimal-empty">{t("home.authorEmpty")}</p>
        ) : (
          <ul className="minimal-list">
            {posts.map((post) => (
              <li key={post.id} className="minimal-list-item">
                {showPublicationDate && (
                  <time className="minimal-date" dateTime={post.publishedAt}>
                    {new Date(post.publishedAt).toLocaleDateString(dateLocale, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </time>
                )}
                <a href={`/posts/${post.slug}`} className="minimal-link">
                  {post.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </ThemeLayout>
  );
}
