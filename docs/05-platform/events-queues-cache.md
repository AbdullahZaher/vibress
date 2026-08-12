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
│   ├── event-envelope.ts
│   ├── event-map.ts
│   ├── event-writer.ts
│   ├── outbox-dispatcher.ts
│   ├── outbox-repository.ts
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

Current durable events:

```text
post.published
post.unpublished
post.deleted
```

The default delivery mode is `EVENT_DELIVERY_MODE=outbox`: post lifecycle
events are written to `outbox_events` inside the same business transaction and
the worker dispatcher relays them to the search queue. `EVENT_DELIVERY_MODE=direct`
keeps the legacy in-process API search relay for local fallback only.

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
