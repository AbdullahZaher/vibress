# Theme Engine ADR

**Status**: Accepted (Batch 7)

## Context

Batch 6 shipped a single built-in presentation directly in `apps/web`. To support switching public presentation at runtime — without rebuilding content, redeploying, or modifying Studio documents — Vibress needs a Theme Engine with a trusted theme contract, safe activation, settings, preview, and fallback.

## Decision

### 1. Themes are trusted build-time registered code

Theme modules live in the repository and are registered explicitly. The database stores only the _identity_ of the active theme plus validated settings — never theme source, assets, or executable values. Dynamic third-party installation (marketplace, ZIP upload, runtime npm install, arbitrary JS execution) is explicitly out of scope.

### 2. Themes consume public contracts only

A theme receives public DTOs (`PublicPost`, `PublicPage`, `PublicTag`, `PublicAuthor`, `PublicPostSummary`) and a `ThemeContext` (site metadata + theme settings). Themes have no access to databases, repositories, Drizzle, storage providers, secrets, or staff sessions. Theme code must never import domain infrastructure.

### 3. Routing, SEO, and discovery stay owned by `apps/web`

Routes (`/`, `/posts/:slug`, `/pages/:slug`, `/tags/:slug`, `/authors/:slug`) remain Web-owned. Canonical URLs, OG/Twitter, JSON-LD, sitemap, robots.txt, and RSS are computed by the Web/SEO layer regardless of theme. Themes influence presentation only and must not duplicate canonical URL logic.

### 4. Active theme selection is persistent and atomic

The active theme + settings live in the `theme_configurations` singleton row. Activation validates the registered theme (manifest, API compatibility, settings defaults) before writing; a failed activation leaves the previous theme active. Invalid persisted theme IDs fall back to `vibress-default`.

### 5. Settings are declarative, validated, data-only

Theme settings use a small schema (string, boolean, number, color hex, select). Server-side validation rejects unknown keys, wrong types, invalid enums, invalid colors, out-of-bounds numbers, and oversized strings. No arbitrary CSS/JS is accepted. Theme settings may contain no secrets.

### 6. Preview is token-bound and short-lived

Admin creates a short-lived signed preview token (10 min) bound to a theme ID. Web middleware resolves the token server-side and renders the theme without activating it. There is no unauthenticated `?theme=` selection; preview never exposes drafts (public content visibility rules remain).

### 7. Fallback is deterministic

If the persisted active theme is unknown/unavailable, the Theme Host renders `vibress-default` with operational error logging. No arbitrary registry entry is selected; no stack traces reach visitors.

## Consequences

- Theme switching, settings changes, and previews take effect on the next public request without a build/restart.
- Two built-in themes (`vibress-default`, `vibress-minimal`) prove the engine and preserve all Batch 6 SEO/content/media semantics.
- Future installable themes (signed packages, sandbox build pipeline, marketplace) can extend the contract without changing the core engine, but are not implemented in Batch 7.
