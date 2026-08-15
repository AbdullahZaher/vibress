# ADR-013: Vibress Release Versioning & Compatibility Strategy

## Context
Prior to Phase 1, Vibress packages and images utilized placeholder `0.0.0` versions. Production stability and enterprise deployments require a predictable Semantic Versioning (SemVer) cadence, immutable Docker tags, release candidate policies, and plugin/theme compatibility boundaries.

## Decision

### 1. Versioning Model (Unified SemVer)
Vibress follows **Semantic Versioning 2.0.0** (`MAJOR.MINOR.PATCH`):
- `MAJOR`: Breaking architectural, REST API, or schema changes without backward-compatible migrations.
- `MINOR`: New domain features, plugins, settings, or additive schema extensions.
- `PATCH`: Security fixes, bug corrections, performance optimizations.

Release candidates are formatted as `vMAJOR.MINOR.PATCH-rc.N` (e.g. `v0.1.0-rc.1`).

### 2. Git & Container Tagging Conventions
- Git release tags: `vX.Y.Z` (e.g. `v0.1.0`)
- Docker image tags:
  - Immutable commit SHA: `vibress-api:<sha>`
  - Release SemVer: `vibress-api:0.1.0`
  - Release minor: `vibress-api:0.1`
  - Latest production release: `vibress-api:latest`

### 3. Build & Operational Metadata Exposure
Application artifacts inject build arguments during compilation:
- `VIBRESS_VERSION`: Product version (defaults to active semver)
- `GIT_SHA`: 7-character git commit hash
- `BUILD_DATE`: ISO 8601 build timestamp

Endpoints exposing safe build metadata:
- `GET /health` / `GET /api/health`: `{ status: "ok", version: "0.1.0", commit: "5d4a25e", environment: "production" }`
- `GET /api/admin/v1/system/integrity`: Verified via staff session RBAC.

### 4. Plugin and Theme Compatibility Manifest Fields
All themes and extensions must declare minimum platform support:
```json
{
  "engines": {
    "vibress": ">=0.1.0 <1.0.0"
  }
}
```

### 5. Migration Startup Ordering
Production deployments enforce:
```text
PostgreSQL / Redis (Healthy)
  → Migration job (db:migrate) runs to completion
  → API / Worker containers execute assertDatabaseSchemaReady()
  → Application serves HTTP traffic
```
