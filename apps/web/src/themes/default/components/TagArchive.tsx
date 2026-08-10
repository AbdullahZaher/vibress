import { ThemeTagArchiveProps, themeSetting } from '../../types';
import { ThemeLayout } from './Layout';

export async function TagArchive(props: ThemeTagArchiveProps) {
  const { tag, posts, pagination } = props;
  const showAuthor = themeSetting(props.settings, 'showAuthor', true) as boolean;
  const showPublicationDate = themeSetting(props.settings, 'showPublicationDate', true) as boolean;

  return (
    <ThemeLayout settings={props.settings} site={props.site}>
      <main>
        <header className="article-header">
          <h1 className="article-title">#{tag.name}</h1>
          {tag.description && <p style={{ color: '#64748b' }}>{tag.description}</p>}
        </header>

        {posts.length === 0 ? (
          <div style={{ padding: '32px 0', color: '#64748b' }}>
            <p>No published posts under this tag.</p>
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
                  {showAuthor && post.primaryAuthor && (
                    <span>
                      by{' '}
                      <a href={`/authors/${post.primaryAuthor.slug}`}>
                        {post.primaryAuthor.name}
                      </a>
                    </span>
                  )}
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
                href={`/tags/${tag.slug}?page=${pagination.page - 1}`}
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
                href={`/tags/${tag.slug}?page=${pagination.page + 1}`}
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
