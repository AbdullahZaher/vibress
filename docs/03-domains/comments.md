# Comments

## Model

`comments` belongs to `member.id` — never staff identity.

| Field                        | Notes                                                 |
| ---------------------------- | ----------------------------------------------------- |
| `post_id` FK                 | The content the comment belongs to                    |
| `member_id` FK               | The comment author (member identity)                  |
| `parent_id` FK null          | Threading parent                                      |
| `body`                       | Plain text, sanitized, max 5000 chars                 |
| `status`                     | `published` / `pending_review` / `hidden` / `deleted` |
| `depth`                      | Thread depth, max 5 (`MAX_COMMENT_DEPTH`)             |
| `like_count` / `reply_count` | Denormalized counters                                 |
| `deleted_at`                 | Tombstone timestamp                                   |

## Content Safety

- Comment bodies are **always treated as plain text**. `sanitizeCommentBody`
  strips HTML tags and control characters before storage, so stored XSS is
  impossible. Verified by tests.
- Public API never renders raw comment body as HTML.

## Threading

- Replies are validated: parent must exist, belong to the same post, be
  published, and not exceed `MAX_COMMENT_DEPTH` (cycle/pathology prevention).
- Deleting a parent uses **tombstone semantics**: the body is replaced with
  `[deleted]` and status set to `deleted`, preserving thread integrity.
  Replies remain, nested under the tombstone.

## Ownership

- Members may edit/delete only their own comments (`FORBIDDEN` otherwise).
- Verified by integration tests (Member B cannot edit/delete Member A).

## Likes

- One like per member per comment, enforced by
  `UNIQUE(comment_likes.member_id, comment_id)`.
- Toggle endpoint increments/decrements the denormalized `like_count`.

## Reports

- One report per member per comment (`UNIQUE(reporter_id, comment_id)`) —
  spam protection; duplicate reports return `ALREADY_REPORTED`.
- Reports have status (`pending` / `resolved`), resolved timestamp, and
  resolving staff identity.

## Moderation

- Staff with `comments.read` can list comments and reports.
- Staff with `comments.moderate` can hide, restore, delete (tombstone), and
  resolve reports.
- Hiding a comment sends a `comment.hidden` notification to its author.
- Hidden/deleted comments are excluded from the public API.

## Events

`comment.created`, `comment.replied`, `comment.updated`, `comment.deleted`,
`comment.hidden`, `comment.reported`, `comment.liked`.
