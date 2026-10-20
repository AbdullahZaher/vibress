# Penetration assessment remediation (2026-10-20)

This change hardens the previously reported Admin EmbedCardEditor sink, outbound
Unsplash downloads, SVG media responses, and Staff password recovery. It does
not represent an independently certified penetration test.

## Security boundaries

- Studio embed HTML is parsed through the existing Studio allowlist before
  browser insertion. Arbitrary URLs no longer become privileged Admin iframes;
  only canonical approved YouTube/Vimeo provider URLs load in frames.
- The SPA's existing enforced CSP keeps `script-src 'self'` without inline
  JavaScript. Approved frame origins are explicitly listed. Inline CSS remains
  enabled because existing React layout controls require it.
- Unsplash API requests validate the exact HTTPS API origin. Authenticated
  requests never follow redirects; image downloads use the shared `safeFetch`
  client with socket and DNS IP checks, per-hop host allowlisting and streamed
  size enforcement.
- Existing SVG media URLs remain addressable but respond with
  `Content-Disposition: attachment` and an additional sandbox CSP. Passive
  SVG files are still accepted at upload, while known executable XML features
  are rejected. Deployments serving media outside the API must enforce
  equivalent headers on their CDN or storage gateway.
- Staff reset token issuance/redemption serializes on the account row.
  Successful reset atomically updates the password, marks all prior unused
  reset tokens as used, revokes sessions and records an audit event.

## Compatibility and deployment

No database schema or released migration changes; existing rows are handled
in place. Existing embeds are retained in persisted content, but unsupported
providers now show links rather than executing third-party frames in Admin.
SVG direct navigation now downloads instead of rendering as a same-origin
active document. Operators using a custom reverse proxy must forward CSP and
Content-Disposition headers and rebuild/redeploy Admin, Portal, API and shared
packages. Verify configured YouTube/Vimeo frame sources in production.

## Verification

Added targeted tests for editor XSS regression, provider URL gates, SSRF host
constraints, SVG media handling, token invalidation and concurrent resets.
Run the repository's existing `pnpm typecheck`, `pnpm lint`,
`pnpm verify:explicit-any`, `pnpm vitest run`, E2E and CI Trivy/audit
checks before marking this change deployment-ready.
