/**
 * Typed map of events that flow through the transactional outbox.
 *
 * Only events with durable delivery requirements are registered here; adding
 * an entry gives the writer and dispatcher compile-time payload typing.
 * Keep event names in sync with the domainEvents emitter in the owning domain.
 */
export interface PostPublishedEventPayload {
  postId: string;
  title: string;
  slug: string;
}

export interface PostUnpublishedEventPayload {
  postId: string;
  slug: string;
}

export interface PostDeletedEventPayload {
  postId: string;
}

export interface OutboxEventPayloadMap {
  "post.published": PostPublishedEventPayload;
  "post.unpublished": PostUnpublishedEventPayload;
  "post.deleted": PostDeletedEventPayload;
}

export type OutboxEventName = keyof OutboxEventPayloadMap;

export function isKnownOutboxEventName(
  value: string,
): value is OutboxEventName {
  return value in EVENT_NAMES;
}

const EVENT_NAMES: Record<OutboxEventName, true> = {
  "post.published": true,
  "post.unpublished": true,
  "post.deleted": true,
};
