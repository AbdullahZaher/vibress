import { ThemeTagArchiveProps, themeSetting } from '../../types';
import { ThemeLayout } from './Layout';

export async function TagArchive(props: ThemeTagArchiveProps) {
  const { tag, posts } = props;
  const showPublicationDate = themeSetting(props.settings, 'showPublicationDate', true) as boolean;

  return (
    <ThemeLayout settings={props.settings} site={props.site}>
      <main>
        <h1 className="minimal-page-title">#{tag.name}</h1>

        {posts.length === 0 ? (
          <p className="minimal-empty">No published posts under this tag.</p>
        ) : (
          <ul className="minimal-list">
            {posts.map((post) => (
              <li key={post.id} className="minimal-list-item">
                {showPublicationDate && (
                  <time className="minimal-date" dateTime={post.publishedAt}>
                    {new Date(post.publishedAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
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
