import { ThemeAuthorArchiveProps, themeSetting } from '../../types';
import { ThemeLayout } from './Layout';

export async function AuthorArchive(props: ThemeAuthorArchiveProps) {
  const { author, posts, pagination } = props;
  const showPublicationDate = themeSetting(props.settings, 'showPublicationDate', true) as boolean;
  const showTags = themeSetting(props.settings, 'showTags', true) as boolean;

  return (
    <ThemeLayout settings={props.settings} site={props.site}>
      <main>
        <header className="article-header">
          <h1 className="article-title">{author.name}</h1>
          {author.bio && <p style={{ color: '#64748b' }}>{author.bio}</p>}
        </header>

        {posts.length === 0 ? (
          <div style={{ padding: '32px 0', color: '#64748b' }}>
            <p>No published posts by this author.</p>
          </div>
        ) : (
          <div className="posts-list">
            {posts.map((post) => (
              <article key={post.id} className="post-card">
                <h2 className="post-card-title">
                  <a href={`/posts/${post.slug}`}>{post.title}</a>
                </h2>
                <div className="article-meta">
                  {showPublicationDate && (
                    <span>
                      {new Date(post.publishedAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </span>
                  )}
                  {showTags &&
                    post.tags.map((t) => (
                      <a key={t.id} href={`/tags/${t.slug}`} className="tag-badge">
                        #{t.name}
                      </a>
                    ))}
                </div>
                {post.excerpt && <p className="post-card-excerpt">{post.excerpt}</p>}
              </article>
            ))}
          </div>
        )}

        {pagination.pages > 1 && (
          <nav className="pagination" aria-label="Pagination">
            {pagination.page > 1 ? (
              <a
                href={`/authors/${author.slug}?page=${pagination.page - 1}`}
                className="pagination-btn"
              >
                ← Previous
              </a>
            ) : (
              <span className="pagination-btn disabled">← Previous</span>
            )}

            <span style={{ fontSize: '14px', color: '#64748b' }}>
              Page {pagination.page} of {pagination.pages}
            </span>

            {pagination.page < pagination.pages ? (
              <a
                href={`/authors/${author.slug}?page=${pagination.page + 1}`}
                className="pagination-btn"
              >
                Next →
              </a>
            ) : (
              <span className="pagination-btn disabled">Next →</span>
            )}
          </nav>
        )}
      </main>
    </ThemeLayout>
  );
}
