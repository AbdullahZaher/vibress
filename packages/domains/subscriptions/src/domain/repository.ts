import { Subscription, CreateSubscriptionData, UpdateSubscriptionData, ListSubscriptionsFilter } from './subscription';

export interface SubscriptionRepository {
  create(data: CreateSubscriptionData): Promise<Subscription>;
  findById(id: string): Promise<Subscription | null>;
  findByProviderSubscriptionId(provider: string, providerSubscriptionId: string): Promise<Subscription | null>;
  update(id: string, data: UpdateSubscriptionData): Promise<Subscription>;
  list(filter?: ListSubscriptionsFilter): Promise<{ subscriptions: Subscription[]; total: number }>;
  findActiveForMember(memberId: string, productId: string): Promise<Subscription | null>;
  hasActiveForMember(memberId: string): Promise<boolean>;
}
