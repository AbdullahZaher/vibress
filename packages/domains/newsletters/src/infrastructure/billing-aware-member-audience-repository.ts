import { MemberRepository } from '@vibress/members';
import { SubscriptionRepository } from '@vibress/subscriptions';
import { AudienceMember, MemberAudienceRepository } from '../application/newsletters-service';
/**
 * Resolves the deterministic baseline audience across members and their
 * subscription state. The paid/free + product filter is enforced here AND
 * re-checked in NewslettersService.computeAudience (defense in depth).
 */
export class BillingAwareMemberAudienceRepository implements MemberAudienceRepository {
  constructor(
    private memberRepo: MemberRepository,
    private subscriptionRepo: SubscriptionRepository
  ) {}

  async listAudienceMembers(filter: 'all' | 'paid' | 'free', productId: string | null): Promise<AudienceMember[]> {
    const { members } = await this.memberRepo.list({ limit: 10000 });
    const result: AudienceMember[] = [];

    for (const member of members) {
      if (member.status !== 'active') continue;

      const { subscriptions } = await this.subscriptionRepo.list({ memberId: member.id, limit: 100 });
      const active = subscriptions.filter((s) => ['active', 'trialing'].includes(s.status) && s.amountMinor > 0);

      const hasPaidSubscription = productId
        ? active.some((s) => s.productId === productId)
        : active.length > 0;

      if (filter === 'paid' && !hasPaidSubscription) continue;
      if (filter === 'free' && hasPaidSubscription) continue;

      result.push({
        id: member.id,
        email: member.email,
        name: member.name,
        emailVerified: !!member.emailVerifiedAt,
        status: member.status,
        hasPaidSubscription,
      });
    }

    return result;
  }
}
