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

/**
 * M03 versioned tenant-resource mutations. Identity is scoped by
 * installation/application/tenant and the adapter's stable event id; the
 * payload carries the exact record version that was committed.
 */
export interface M03ResourceEventPayload {
  applicationId: string;
  installationId: string;
  tenantId: string;
  resourceId: string;
  recordId: string;
  code: string;
  versionToken: string;
}

export interface OutboxEventPayloadMap {
  "post.published": PostPublishedEventPayload;
  "post.unpublished": PostUnpublishedEventPayload;
  "post.deleted": PostDeletedEventPayload;
  "m03.resource.created": M03ResourceEventPayload;
  "m03.resource.updated": M03ResourceEventPayload;
  "m03.resource.deleted": M03ResourceEventPayload;
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
  "m03.resource.created": true,
  "m03.resource.updated": true,
  "m03.resource.deleted": true,
};
