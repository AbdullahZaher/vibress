# VIBRESS THEME DESIGNER GUIDE — 07B: COMMENTS & COMMUNITY

This guide defines the official Vibress Theme API specifications for integrating reader discussion, moderation, comments rendering, and interaction states in Vibress themes.

---

## 1. Overview

Comments and community interactions in Vibress are a first-class platform capability. Readers can engage in threaded discussions, like comments, report abusive content, and reply hierarchically.

Key platform principles:
- **Zero Direct API Calls**: Themes MUST NOT invoke `fetch()` or custom REST endpoints to interact with comments. All interactions run through the official Vibress Comments runtime and `{% comments %}` Liquid tag.
- **Strict Publication Isolation**: All comment queries and mutations are isolated at the database level by `publication_id`.
- **Zero N+1 Queries**: Comment counts on post collections and feed cards are batched at the data layer in a single query.
- **Full Localization & RTL**: Seamless native support for English (LTR) and Arabic (RTL) using CSS logical properties.

---

## 2. Comments Architecture

The comments subsystem is structured in layers:

```
┌────────────────────────────────────────────────────────┐
│                      Liquid Theme                      │
│   {{ post.comment_count }}   |   {% comments %}        │
└───────────────────────────┬────────────────────────────┘
                            │ mounts
┌───────────────────────────▼────────────────────────────┐
│          Official Vibress Comments Runtime             │
│    (State management, moderation filters, forms)       │
└───────────────────────────┬────────────────────────────┘
                            │ authenticated requests
┌───────────────────────────▼────────────────────────────┐
│               Public Comments API Layer                │
│    /api/v1/content/posts/:id/comments                  │
│    /api/members/v1/comments/:id/like                   │
│    /api/members/v1/comments/:id/report                 │
└───────────────────────────┬────────────────────────────┘
                            │ tenant isolation
┌───────────────────────────▼────────────────────────────┐
│          PostgreSQL Database (publication_id)          │
└────────────────────────────────────────────────────────┘
```

---

## 3. The `{% comments %}` Tag

In Liquid templates (such as `post.liquid`), you render the comments section using the official Liquid tag:

```liquid
{% if site.comments_enabled %}
  <section class="theme-comments-section" id="comments">
    <div class="theme-comments-header">
      <h2>{{ "theme.comments" | t | default: "Discussion" }}</h2>
      {% if post.comment_count > 0 %}
        <span class="theme-comments-count-badge">{{ post.comment_count }}</span>
      {% endif %}
    </div>

    {% comments %}
  </section>
{% endif %}
```

The `{% comments %}` tag automatically renders the container `#vb-comments-root` and injects the official comments runtime client with the current post context, locale, and tenant configuration.

---

## 4. Comment Configuration (`SiteCommentsConfig`)

Theme context exposes site-wide comments configuration via the `site` and `settings` objects:
- `site.comments_enabled` (boolean): Whether comments are enabled globally for the publication.
- `site.locale` (string): Current locale (`en`, `ar`, etc.).
- `site.direction` (string): Current text direction (`ltr` or `rtl`).

---

## 5. Post Comment Count (`post.comment_count` / `post.commentCount`)

Every post object in Liquid and JSON viewmodels provides the authoritative count of approved/published comments:

### In Post Headers & Bylines:
```liquid
{% if post.comment_count != nil and post.comment_count > 0 %}
  <a href="#comments" class="post-comments-link" aria-label="{{ post.comment_count }} comments">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    <span>{{ post.comment_count }}</span>
  </a>
{% endif %}
```

### In Feed & Archive Cards (`home.liquid`, `tag.liquid`, `author.liquid`):
```liquid
{% if post.comment_count != nil and post.comment_count > 0 %}
  <span class="post-card-comments">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    {{ post.comment_count }}
  </span>
{% endif %}
```

---

## 6. PostViewModel Specification

`PostViewModel` guarantees the following fields across all endpoints:

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique post identifier (UUID or CUID) |
| `title` | `string` | Post title |
| `slug` | `string` | Post URL slug |
| `commentCount` | `number` | Authoritative count of published comments |
| `comment_count` | `number` | Canonical snake_case alias matching `commentCount` |
| `publishedAt` | `string \| null` | ISO date string of publication date |
| `html` | `string` | Rendered post body HTML |
| `excerpt` | `string` | Post excerpt |
| `featureImage` | `object \| null` | Post cover image object |
| `primaryAuthor` | `AuthorViewModel \| null`| Primary post author |
| `tags` | `TagViewModel[]` | Array of tags attached to post |

---

## 7. CommentViewModel Specification

When rendered or manipulated by the client runtime, each comment conforms to:

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique comment ID |
| `postId` | `string` | Associated post ID |
| `memberId` | `string` | Author member ID |
| `authorName` | `string` | Display name of commenter |
| `authorAvatar` | `string \| null` | URL of author avatar |
| `body` | `string` | Plain text comment body (sanitized, no raw HTML) |
| `status` | `string` | `"published" \| "pending_review" \| "deleted" \| "hidden"` |
| `likeCount` | `number` | Total number of likes |
| `hasLiked` | `boolean` | Whether current viewing member liked this comment |
| `replyCount` | `number` | Number of direct replies |
| `parentId` | `string \| null` | Parent comment ID if threaded reply |
| `depth` | `number` | Thread nesting depth (0 for root, max 3) |
| `createdAt` | `string` | ISO timestamp of creation |

---

## 8. Public Interaction States

Theme designers must style or provide layout containers for the following interactive states:

1. **Loading State**: Displaying skeleton cards or spinner while fetching discussion thread.
2. **Empty State**: Friendly invitation to start the conversation when `comment_count == 0`.
3. **Loaded State**: List of threaded comments with avatars, timestamps, and action buttons.
4. **Error State**: Non-blocking error alerts with localized retry triggers.
5. **Authenticated State**: Active composer with current member avatar and quick submit.
6. **Unauthenticated State**: Sign-in / subscribe prompt to participate in discussion.
7. **Pending Moderation**: Submitter-only banner indicating comment is awaiting moderation.
8. **Tombstone State**: Deleted comments displayed with `[deleted]` placeholder to preserve thread hierarchy.
9. **Nested Replies**: Indented sub-threads (max depth 3).
10. **Liked / Not Liked**: Interactive like button toggle with active heart icon.
11. **Report Flow**: Modal dialog allowing readers to flag inappropriate comments with reason codes.
12. **Submitting State**: Disabled button state with progress indicator during network request.
13. **Rate Limited**: Graceful cooldown message when submission rate limits are reached.

---

## 9. Comments Runtime & Styling Customization

All comments UI elements carry standard `.vb-` class names. Themes customize appearance by overriding CSS variables or providing specific scoped rules:

```css
/* Container */
.theme-comments-section {
  margin-block-start: 3rem;
  padding-block-start: 2rem;
  border-block-start: 1px solid var(--theme-border);
}

/* Composer */
.vb-comment-form-box {
  background: var(--theme-card-bg);
  border: 1px solid var(--theme-border);
  border-radius: 8px;
  padding: 1.25rem;
}

.vb-comment-textarea {
  background: var(--theme-bg);
  color: var(--theme-text);
  border: 1px solid var(--theme-border);
  border-radius: 6px;
}

.vb-comment-btn-primary {
  background: var(--theme-accent);
  color: #fff;
  border-radius: 6px;
}

/* Comment Item & Replies */
.vb-comment-item {
  background: var(--theme-card-bg);
  border: 1px solid var(--theme-border);
}

.vb-comment-replies-thread {
  margin-inline-start: 1.5rem;
  padding-inline-start: 1rem;
  border-inline-start: 2px solid var(--theme-border);
}
```

---

## 10. Authentication & Member Session

The comments runtime integrates with `@vibress/members` session:
- If a member is logged in, their session cookie authenticates comment creation and like actions.
- If unauthenticated, clicking the comment box displays the sign-in modal without navigating away from the article.

---

## 11. Likes System

Readers can toggle likes on comments:
- Endpoint: `POST /api/members/v1/comments/:id/like`
- Optimistic UI updates like count instantly.
- Automatic rollback on network or authentication failure.

---

## 12. Reporting System

Readers can flag comments for review:
- Endpoint: `POST /api/members/v1/comments/:id/report`
- Standard reason codes: `spam`, `harassment`, `hate_speech`, `misinformation`, `other`.
- Reported comments enter the publication's Admin Moderation queue.

---

## 13. Threaded Replies

- Max nesting depth: 3 levels.
- Direct reply button opens inline composer under target comment.
- Thread lines use CSS logical `border-inline-start` for seamless RTL mirroring.

---

## 14. Arabic & RTL Architecture

Vibress is fully bilingual (English & Arabic). Theme comments styling MUST use CSS Logical Properties:

```css
/* CORRECT: Logical CSS */
.vb-comment-meta-row {
  margin-inline-start: 0.5rem;
  text-align: start;
}
.vb-comment-replies-thread {
  margin-inline-start: 1.5rem;
  padding-inline-start: 1rem;
  border-inline-start: 2px solid var(--theme-accent);
}

/* INCORRECT: Physical CSS (Breaks RTL) */
.vb-comment-meta-row {
  margin-left: 0.5rem;
  text-align: left;
}
.vb-comment-replies-thread {
  margin-left: 1.5rem;
  padding-left: 1rem;
  border-left: 2px solid var(--theme-accent);
}
```

---

## 15. Responsive Design

Themes must maintain layout integrity across all viewport widths:
- `320px` - `414px` (Mobile): Single-column composer, compact avatars, condensed meta row.
- `768px` (Tablet): Full width threaded indentation.
- `1024px` - `1280px+` (Desktop): Aligned with article reading width.
- `word-break: break-word` and `overflow-wrap: anywhere` must be applied to prevent overflow from long strings or Arabic ligatures.

---

## 16. Accessibility (A11y)

- All buttons must have visible focus rings (`:focus-visible`).
- Count badges and icons must have descriptive `aria-label` or `aria-hidden="true"`.
- Text areas must have associated `<label>` or `aria-label`.
- Error messages use `role="alert"`.
- Keyboard navigation: Full tab sequence without traps.

---

## 17. Security Rules

1. **No Raw HTML Injection**: Comment bodies are sanitized plain text. Themes must never render unescaped comment text with `| raw`.
2. **Database Isolation**: All operations enforce `publication_id`.
3. **Idempotency**: Comment submissions include client IDs to prevent double submissions.

---

## 18. Performance & Zero N+1

Comment counts for post lists are retrieved via single batched queries. Themes should use `post.comment_count` freely on cards and archive rows without fear of performance degradation.

---

## 19. Testing Theme Comments

To verify your theme comments implementation:
1. Render a post with 0 comments → Verify empty state and comment count 0 / omitted.
2. Render a post with 5+ comments and replies → Verify thread nesting.
3. Test Arabic locale (`site.direction == "rtl"`) → Verify right-to-left thread alignment.
4. Test mobile view (`375px`) → Verify zero horizontal scroll.

---

## 20. Troubleshooting

| Symptom | Cause | Solution |
|---|---|---|
| Comments not appearing on post | Missing `{% comments %}` tag | Add `{% comments %}` in `post.liquid` |
| `post.comment_count` is 0 on card | Post has no published comments | Expected; use `{% if post.comment_count > 0 %}` |
| RTL thread line is on the left | Used `border-left` instead of `border-inline-start` | Replace with CSS logical property |
| Double submission of comments | Custom fetch instead of official runtime | Remove custom JavaScript; use official runtime |

---

## 21. Complete Reference Example (`post.liquid`)

```liquid
<article class="theme-article">
  <header class="theme-article-header">
    <h1>{{ post.title | escape }}</h1>
    <div class="theme-article-meta">
      <time datetime="{{ post.publishedAt }}">{{ post.publishedAt | format_date }}</time>
      {% if post.comment_count != nil and post.comment_count > 0 %}
        <a href="#comments" class="theme-comments-count-link">
          {{ post.comment_count }} {{ "theme.comments" | t }}
        </a>
      {% endif %}
    </div>
  </header>

  <div class="theme-article-body">
    {{ post.html }}
  </div>

  <section class="theme-comments-section" id="comments">
    <div class="theme-comments-header">
      <h2>{{ "theme.comments" | t }}</h2>
      {% if post.comment_count > 0 %}
        <span class="theme-comments-pill">{{ post.comment_count }}</span>
      {% endif %}
    </div>
    {% comments %}
  </section>
</article>
```

---

## 22. Theme Delivery Checklist

- [ ] `post.liquid` includes official `{% comments %}` tag.
- [ ] Post header/byline exposes `post.comment_count` linked to `#comments`.
- [ ] Feed/archive cards expose `post.comment_count` in metadata.
- [ ] Theme uses CSS logical properties for all comment layout and indentation.
- [ ] Theme tested in English (LTR) and Arabic (RTL).
- [ ] Theme tested at 375px mobile viewport without overflow.
- [ ] No direct `fetch()` or custom comments APIs inside theme templates.
