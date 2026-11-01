# Runtime Applications

## `apps/admin`

Administration interface for staff.

Responsibilities:

- dashboard
- posts/pages
- tags/authors
- media
- members
- newsletters
- subscriptions
- comments
- analytics
- integrations
- themes
- users/roles
- settings

Recommended stack:

- React
- TypeScript
- Vite
- TanStack Router
- TanStack Query
- Tailwind CSS
- shadcn/ui

## `apps/web`

Public site rendering.

Responsibilities:

- posts and pages
- tag/author archives
- SEO
- RSS
- sitemap
- themes
- public search
- metadata
- SSR

Recommended stack: Next.js.

## `apps/api`

Fastify HTTP server.

Responsibilities only:

- routing
- authentication handoff
- authorization handoff
- validation
- serialization
- rate limiting
- CSRF
- request context
- error mapping

No business logic.

## `apps/worker`

Background processing.

Responsibilities:

- scheduled publishing
- email/newsletter delivery
- image/media processing
- webhook dispatch
- analytics aggregation
- cleanup
- import/export
- search indexing

## `apps/portal`

Member-facing experience.

Responsibilities:

- login/register
- account/profile
- memberships
- billing
- subscription management
- comment identity
- member preferences

## React state management

For React-based admin, portal and Vibress-owned Studio integration UI, follow the [Vibress React State Management Standard](react-state-management.md), [upstream Markdown notes](react-state-reference-notes.md) and [review checklist](react-state-review-checklist.md). Reuse each app's actual API and state/query patterns rather than assuming identical dependencies.
