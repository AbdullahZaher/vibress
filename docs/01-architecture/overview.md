# Vibress Architecture Overview

## Architectural style

Vibress uses a **modular monolith**.

A single deployment may host multiple runtime applications, but business functionality is divided into explicit domain packages with enforced dependency boundaries.

```text
Users
  │
  ├────────────┬─────────────┐
  ▼            ▼             ▼
Admin       Public Web      Portal
  │            │             │
  └────────────┴──────┬──────┘
                      ▼
                 Vibress API
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
       Domains      Events      Plugins
          │           │           │
          │           ▼           │
          │         Queue         │
          │           │           │
          │           ▼           │
          │         Worker        │
          │                       │
          ├──────────┬────────────┤
          ▼          ▼            ▼
      PostgreSQL    Redis       Storage
```

## Why modular monolith

Vibress is expected to contain tightly related publishing capabilities:

- posts and pages
- editorial workflows
- memberships
- subscriptions
- newsletters
- media
- comments
- analytics
- themes
- integrations
- plugins

Starting with microservices would introduce network coordination, retry semantics, distributed transactions, service discovery, multi-service versioning, and operational complexity before those costs are justified.

The modular monolith preserves:

- one main codebase
- local transactions
- fast development
- clear refactoring paths
- future service extraction when required

## Extraction candidates

If Vibress later requires independent scaling, the first candidates are:

1. Email/newsletter delivery
2. Analytics ingestion and aggregation
3. Media processing
4. Search indexing
5. Webhook dispatch

These should still communicate through stable events/contracts rather than internal imports.
