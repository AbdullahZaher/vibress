# Events, Queues, and Cache

## Domain events

Use events to decouple side effects from state changes.

Examples:

```text
post.created
post.updated
post.published
member.created
subscription.started
subscription.cancelled
newsletter.sent
media.uploaded
```

## Event package

```text
packages/events/
├── src/
│   ├── event-bus.ts
│   ├── event-handler.ts
│   ├── event-registry.ts
│   ├── events/
│   └── index.ts
└── package.json
```

## Event reliability

For important cross-process effects, use an **outbox pattern**.

Transaction:

```text
DB state change
     +
outbox event insert
```

Worker:

```text
outbox
  ↓
publish/dispatch
  ↓
mark delivered
```

This prevents losing important events between database commit and queue publication.

## Queues

Use Redis + BullMQ.

Recommended queues:

```text
email
newsletter
media
webhook
analytics
search
system
scheduled-publishing
```

Every job handler must be idempotent.

## Cache

`packages/cache` abstracts cache usage.

Recommended rules:

- cache is never source of truth
- key format is versioned
- cache invalidation follows domain events
- sensitive per-user data must include strict identity/tenant scoping
- Redis failures should not corrupt transactional state
