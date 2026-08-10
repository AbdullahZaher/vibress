import { SubscriptionRepository } from '../domain/repository';
import {
  Subscription,
  SubscriptionStatus,
  CreateSubscriptionData,
  UpdateSubscriptionData,
  ListSubscriptionsFilter,
  ACCESS_GRANTING_STATUSES,
} from '../domain/subscription';
import { domainEvents } from '@vibress/events';

export class SubscriptionDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class SubscriptionsService {
  constructor(private repo: SubscriptionRepository) {}

  async createSubscription(data: CreateSubscriptionData): Promise<Subscription> {
    // Prevent duplicate active subscription for the same member+product
    if (['trialing', 'active', 'past_due', 'unpaid'].includes(data.status)) {
      const existing = await this.repo.findActiveForMember(data.memberId, data.productId);
      if (existing) {
        throw new SubscriptionDomainError('SUBSCRIPTION_ALREADY_ACTIVE', 'Member already has an active subscription for this product');
      }
    }

    const subscription = await this.repo.create(data);
    domainEvents.emit('subscription.created', { subscriptionId: subscription.id, memberId: subscription.memberId });
    return subscription;
  }

  /**
   * Applies a provider-synchronized update with out-of-order protection:
   * older provider events cannot overwrite newer subscription state.
   */
  async applyProviderUpdate(
    subscriptionId: string,
    data: UpdateSubscriptionData,
    providerEventTimestamp: Date
  ): Promise<Subscription> {
    const current = await this.repo.findById(subscriptionId);
    if (!current) throw new SubscriptionDomainError('SUBSCRIPTION_NOT_FOUND', 'Subscription not found');

    // Out-of-order guard: ignore events older than the last applied provider event
    if (current.providerEventTimestamp && providerEventTimestamp.getTime() < current.providerEventTimestamp.getTime()) {
      return current;
    }

    const previousStatus = current.status;
    const updated = await this.repo.update(subscriptionId, {
      ...data,
      providerEventTimestamp,
    });

    this.emitStatusEvents(updated, previousStatus);
    return updated;
  }

  async updateSubscription(id: string, data: UpdateSubscriptionData): Promise<Subscription> {
    const current = await this.repo.findById(id);
    if (!current) throw new SubscriptionDomainError('SUBSCRIPTION_NOT_FOUND', 'Subscription not found');
    const previousStatus = current.status;
    const updated = await this.repo.update(id, data);
    this.emitStatusEvents(updated, previousStatus);
    return updated;
  }

  /**
   * Cancels a subscription at period end (member-facing default).
   * Only the owning member may cancel (ownership enforced by caller).
   */
  async cancelAtPeriodEnd(id: string): Promise<Subscription> {
    const current = await this.repo.findById(id);
    if (!current) throw new SubscriptionDomainError('SUBSCRIPTION_NOT_FOUND', 'Subscription not found');
    if (!['trialing', 'active', 'past_due'].includes(current.status)) {
      throw new SubscriptionDomainError('SUBSCRIPTION_NOT_CANCELLABLE', 'Subscription is not cancellable in its current state');
    }
    if (current.cancelAtPeriodEnd) {
      return current;
    }

    const updated = await this.repo.update(id, { cancelAtPeriodEnd: true });
    domainEvents.emit('subscription.cancel_scheduled', { subscriptionId: id, memberId: current.memberId });
    return updated;
  }

  /**
   * Reverses a scheduled cancellation.
   */
  async resume(id: string): Promise<Subscription> {
    const current = await this.repo.findById(id);
    if (!current) throw new SubscriptionDomainError('SUBSCRIPTION_NOT_FOUND', 'Subscription not found');
    if (!current.cancelAtPeriodEnd) {
      throw new SubscriptionDomainError('SUBSCRIPTION_NOT_RESUMABLE', 'Subscription is not scheduled for cancellation');
    }
    if (current.status === 'cancelled' || current.status === 'expired') {
      throw new SubscriptionDomainError('SUBSCRIPTION_NOT_RESUMABLE', 'Subscription is already cancelled');
    }

    const updated = await this.repo.update(id, { cancelAtPeriodEnd: false });
    domainEvents.emit('subscription.resumed', { subscriptionId: id, memberId: current.memberId });
    return updated;
  }

  /**
   * Admin/member immediate cancellation (explicit path).
   */
  async cancelImmediate(id: string): Promise<Subscription> {
    const current = await this.repo.findById(id);
    if (!current) throw new SubscriptionDomainError('SUBSCRIPTION_NOT_FOUND', 'Subscription not found');

    const updated = await this.repo.update(id, {
      status: 'cancelled',
      cancelAtPeriodEnd: false,
      cancelledAt: new Date(),
      endedAt: new Date(),
    });
    domainEvents.emit('subscription.cancelled', { subscriptionId: id, memberId: current.memberId });
    return updated;
  }

  async getSubscription(id: string): Promise<Subscription | null> {
    return this.repo.findById(id);
  }

  async getSubscriptionByProviderId(provider: string, providerSubscriptionId: string): Promise<Subscription | null> {
    return this.repo.findByProviderSubscriptionId(provider, providerSubscriptionId);
  }

  async listSubscriptions(filter?: ListSubscriptionsFilter): Promise<{ subscriptions: Subscription[]; total: number }> {
    return this.repo.list(filter);
  }

  /**
   * Centralized access policy: which statuses grant access.
   * past_due intentionally does NOT grant access (conservative default).
   */
  hasAccess(subscription: Subscription): boolean {
    return ACCESS_GRANTING_STATUSES.includes(subscription.status);
  }

  async memberHasActiveSubscription(memberId: string): Promise<boolean> {
    return this.repo.hasActiveForMember(memberId);
  }

  private emitStatusEvents(updated: Subscription, previousStatus: SubscriptionStatus): void {
    if (updated.status === previousStatus) return;
    switch (updated.status) {
      case 'active':
        domainEvents.emit('subscription.activated', { subscriptionId: updated.id, memberId: updated.memberId });
        break;
      case 'past_due':
      case 'unpaid':
        domainEvents.emit('subscription.payment_failed', { subscriptionId: updated.id, memberId: updated.memberId, status: updated.status });
        break;
      case 'cancelled':
        domainEvents.emit('subscription.cancelled', { subscriptionId: updated.id, memberId: updated.memberId });
        break;
      case 'expired':
        domainEvents.emit('subscription.ended', { subscriptionId: updated.id, memberId: updated.memberId });
        break;
      default:
        domainEvents.emit('subscription.updated', { subscriptionId: updated.id, memberId: updated.memberId, status: updated.status });
    }
  }
}
