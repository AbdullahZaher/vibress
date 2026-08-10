# ADR-019: Settings & System Tools Boundary

**Status:** Accepted
**Date:** Batch 14

## Context

Vibress needs an operational administration layer. Without boundaries,
settings could become an untyped dump, audit could be tampered with, imports
could execute arbitrary code or traverse paths, and system tools could expose
secrets or shell access.

## Decision

1. **Typed, namespaced settings with explicit classification.** Each namespace
   owns its schema and validation; the Settings domain orchestrates
   persistence and exposure. Every setting is classified `public`,
   `staff-visible`, `secret`, or `internal`; public APIs never leak
   staff/internal/secret values, secret values are masked, and changes are
   audited without logging raw values.

2. **Audit is append-only with redaction.** Staff exploration supports
   filters and pagination; there is no delete endpoint; metadata is sanitized
   for sensitive keys; request IDs enable correlation.

3. **Import/export is versioned, validated, and job-based.** The Vibress-native
   envelope rejects arbitrary shapes. Zip-slip and zip-bomb defenses are
   enforced. Imports never execute imported code and never auto-install
   plugins/themes. Exports exclude all secrets (tokens, API keys, provider
   credentials, `VIBRESS_ENCRYPTION_KEY`). Jobs persist state with bounded
   artifact retention.

4. **Redirects are managed and loop-safe.** Only documented HTTP codes;
   protected route prefixes cannot be hijacked; external destinations are
   http/https-only; resolution is bounded and cycle-detecting.

5. **System tools are read-only diagnostics + bounded maintenance.** No shell,
   no raw SQL console, no filesystem browser, no arbitrary command execution.
   Integrity checks are non-destructive.

## Consequences

- Operators gain settings, audit exploration, import/export, redirects,
  diagnostics, maintenance, and integrity checks without unrestricted
  administration capabilities.
- A normal export is documented as NOT a disaster-recovery backup; the
  backup procedure (PostgreSQL + storage + encryption key + config +
  plugins) is documented separately.
