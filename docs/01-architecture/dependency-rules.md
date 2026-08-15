# Dependency Rules

These rules are mandatory and should be enforced with Nx tags, ESLint boundaries, or dependency-cruiser.

## Allowed direction

```text
apps
 ↓
domain public APIs
 ↓
domain internals
 ↓
platform interfaces
```

## Core rules

### 1. Applications do not own business rules

Bad:

```text
apps/api/routes/posts.ts
  └── publish permission rules
  └── slug generation rules
  └── revision rules
```

Good:

```text
apps/api
  └── PublishPostUseCase
        └── packages/domains/posts
```

### 2. Domains do not import another domain's internals

Bad:

```ts
import { SubscriptionRepositoryImpl } from "@vibress/members/internal";
```

Good:

- public domain API
- domain service interface
- event
- query contract

### 3. Database package has no business logic

`packages/database` owns:

- schema definitions
- clients
- transactions
- migration tooling
- database primitives

It must not decide who may publish, when a subscription is valid, or how a newsletter behaves.

### 4. UI never accesses the database

Admin, Web, and Portal communicate through public APIs or server-side application interfaces.

### 5. Plugins never import private platform internals

Plugins use `@vibress/plugin-sdk`.

### 6. Vibress Studio never depends on Vibress Core

The editor receives generic callbacks and extension contracts.

## Recommended Nx tags

Examples:

```text
type:app
type:domain
type:platform
type:ui
type:plugin
scope:posts
scope:members
scope:storage
```

Boundary policies should reject circular and cross-domain internal imports.
