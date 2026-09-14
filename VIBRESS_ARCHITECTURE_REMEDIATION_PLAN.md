# VIBRESS — ARCHITECTURE REMEDIATION PLAN
## Modular Monolith Solidification, Domain Boundaries & Distributed Resilience

---

## 1. Architectural Truth: Modular Monolith vs Microservices

### The Misconception
Previous documentation and promotional descriptions occasionally characterized Vibress as a "distributed microservices architecture."

### The Architectural Reality
Vibress is a **TypeScript Modular Monolith with an Out-of-Process Background Worker**:
1. **Shared Database**: All domain packages (`@vibress/posts`, `@vibress/auth`, `@vibress/billing`, `@vibress/email`, `@vibress/events`, etc.) operate over the same PostgreSQL database schema defined in `@vibress/database`.
2. **Shared Memory / Runtime**: Within `apps/api`, all domain services (`postsService`, `authorsService`, `revisionsService`, `authService`, `billingService`, `themeService`) are instantiated in the same Node.js process and communicate via in-memory TypeScript function calls.
3. **Dedicated Asynchronous Worker**: `apps/worker` runs as a separate daemon to execute heavy, asynchronous background tasks (email delivery, search indexing, webhook retries, outbox polling). Communication between the API and Worker is mediated strictly through **PostgreSQL (Transactional Outbox)** and **Redis (BullMQ queues)**.

### Architectural Decision: Embrace the Modular Monolith
**Conclusion**: Converting Vibress to true network-separated microservices would introduce immense network overhead, distributed transaction failures, complex gRPC/HTTP meshes, and operational fragility with zero benefit for an open-source CMS.  
**Target Architecture**: Solidify Vibress as a **world-class Modular Monolith**. Enforce strict architectural boundaries at compile-time and runtime using Nx boundary rules and dependency inversion.

---

## 2. Core Architectural Weaknesses Identified

1. **Leaky Domain Boundaries**: Domain services directly import `getDb()` and execute ad-hoc Drizzle queries rather than routing through isolated repositories.
2. **Single-Tenant Database Coupling**: Relational entities assume a single global namespace. There is no `publication_id` partitioning.
3. **Ephemeral In-Memory State**: Collaboration updates, AI token budgets, and presence tracking are held in heap `Map` objects, breaking horizontal scalability and zero-downtime rolling restarts.
4. **Soft-Deleted Unique Constraint Collisions**: Relational unique constraints on `slug` do not exclude soft-deleted records.

---

## 3. Architecture Target Design

```
                                  CLIENT TIER
             ┌─────────────────────────┬─────────────────────────┐
             │    Admin React SPA      │   Next.js Reader SSR    │
             │       (Vite :8080)      │       (Web :7778)       │
             └────────────┬────────────┴────────────┬────────────┘
                          │                         │
                          ▼                         ▼
             ┌───────────────────────────────────────────────────┐
             │               NGINX GATEWAY (:8080)               │
             │  • TLS Termination, Rate Limiting, Route Routing  │
             └─────────────────────────┬─────────────────────────┘
                                       │
                                       ▼
             ┌───────────────────────────────────────────────────┐
             │                 VIBRESS API HOST                  │
             │               (Fastify Modular Monolith)          │
             │                                                   │
             │   ┌───────────────────────────────────────────┐   │
             │   │             HTTP Routing Layer            │   │
             │   └─────────────────────┬─────────────────────┘   │
             │                         │                         │
             │   ┌─────────────────────▼─────────────────────┐   │
             │   │            Domain Services Layer          │   │
             │   │  Posts  •  Pages  •  Media  •  Billing   │   │
             │   │  Auth   •  Themes •  I18n   •  Studio     │   │
             │   └──────────────┬──────────────────┬─────────┘   │
             │                  │                  │             │
             │   ┌──────────────▼──────┐    ┌──────▼─────────┐   │
             │   │ Repositories Layer  │    │ Outbox Writer  │   │
             │   └──────────────┬──────┘    └──────┬─────────┘   │
             └──────────────────┼──────────────────┼─────────────┘
                                │                  │
         ┌──────────────────────┼──────────────────┼──────────────────────┐
         │                      ▼                  ▼                      │
         │             ┌───────────────────────────────────┐              │
         │             │        POSTGRESQL DATABASE        │              │
         │             │  • Multi-Publication Schemas      │              │
         │             │  • Transactional Outbox Events    │              │
         │             └─────────────────▲─────────────────┘              │
         │                               │                                │
         │                               │ FOR UPDATE SKIP LOCKED         │
         │                      ┌────────┴────────┐                       │
         │                      │ Outbox Poller   │                       │
         │                      └────────▲────────┘                       │
         │                               │                                │
         │             ┌─────────────────┴─────────────────┐              │
         │             │          VIBRESS WORKER           │              │
         │             │        (BullMQ Daemon Host)       │              │
         │             │  • Email Delivery  • Webhooks     │              │
         │             │  • Search Indexer  • Scheduler    │              │
         │             └─────────────────┬─────────────────┘              │
         │                               │                                │
         │                      ┌────────▼────────┐                       │
         │                      │  REDIS 7 (Queues│                       │
         │                      │  & Cache Engine)│                       │
         │                      └─────────────────┘                       │
         └────────────────────────────────────────────────────────────────┘
```

---

## 4. Key Architectural Remediations

### 4.1 Strict Domain Encapsulation (Repository Pattern Enforcement)
- **Problem**: Some services bypass repositories and execute direct `getDb()` queries, leaking Drizzle table references across domain lines.
- **Remediation**:
  - Every domain package must expose explicit interfaces (e.g., `PostRepository`, `MediaRepository`).
  - Direct database access is restricted to the infrastructure layer within each domain package.
  - Nx `enforce-module-boundaries` eslint rules will be configured to prohibit direct schema cross-imports between sibling domain packages.

### 4.2 Decoupling Asynchronous Work from HTTP Handlers
- **Standard**: State-changing API routes must NEVER perform direct external network calls (e.g., SMTP dispatch, third-party webhook push, AI background indexing) inside the HTTP request transaction.
- **Execution**:
  - The HTTP request writes state changes and an `outbox_events` record in a single local PostgreSQL transaction.
  - The response returns immediately to the client (P99 < 50ms).
  - The background worker claims outbox rows and dispatches jobs to BullMQ queues asynchronously.

### 4.3 Stateless Application Tier & Distributed State Relocation
- **Rule**: No Node.js process heap memory may hold state required across requests or between instances.
- **Relocations**:
  1. **AI Rate Limits & Token Quotas**: Migrate from `Map<string, number[]>` to Redis string counters with TTL.
  2. **Editor Presence**: Migrate from `EditorialCollaborationService.presenceMap` to Redis Hashes with 15-second TTL heartbeats.
  3. **CRDT Updates**: Migrate from `EditorialCollaborationService.docUpdatesMap` to PostgreSQL CRDT append logs + Redis Pub/Sub broadcast.

---

## 5. Transactional Integrity & Concurrency Architecture

### Outbox Reliability Guarantees
- **Guarantee**: At-least-once delivery for all domain events.
- **Concurrency Control**: Outbox claims use:
  ```sql
  SELECT id, event_type, payload
  FROM outbox_events
  WHERE status = 'pending' AND (available_after IS NULL OR available_after <= NOW())
  ORDER BY created_at ASC
  LIMIT 50
  FOR UPDATE SKIP LOCKED;
  ```
- **Stale Claim Heartbeat**: Workers updating rows set `locked_until = NOW() + INTERVAL '60 seconds'`. If a worker pod crashes, the row automatically becomes eligible for reclaim by another pod without human intervention.

### Idempotent Consumer Pattern
All queue consumers must enforce idempotency:
1. Webhooks check `findByProviderEventId()`.
2. Email delivery checks `recipient.status === 'pending'`.
3. Search indexer applies `ON CONFLICT (entity_type, entity_id) DO UPDATE`.
