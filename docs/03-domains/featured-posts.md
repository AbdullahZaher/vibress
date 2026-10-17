# Featured posts

A featured post is an editorial flag, independent of its feature image and publication status.

- Open a post's settings in Studio and select **Feature this post**. The flag is saved using the publication-scoped edit route and optimistic concurrency. The Posts list includes a Featured filter.
- Public API: `GET /api/content/v1/posts?featured=true` (or `featured=false`). Without a flag filter, existing date sorting and pagination remain unchanged. Both primary and translated locales paginate and count the filtered set.
- Public post summaries and details expose `featured`. The Theme SDK already exposes `post.featured`: Liquid themes can use `{% if post.featured %}` for editorial treatment. Built-in Molten retains its legacy first-post visual treatment.
- Flagged drafts, future posts and private/members-only posts do not appear in the public featured feed. A published translation must exist for the selected locale.
- Migration 0039 adds `NOT NULL DEFAULT false`, leaving legacy posts unfeatured without a data rewrite. Apply migrations before deploying new services. If a short lock cannot be obtained, retry during a quieter window.
