import { MemberRepository } from "@vibress/members";
import { SubscriptionRepository, Subscription } from "@vibress/subscriptions";
import {
  AudienceMember,
  MemberAudienceRepository,
} from "../application/newsletters-service";

/**
 * Resolves the deterministic baseline audience across members and their
 * subscription state. The paid/free + product filter is enforced here AND
 * re-checked in NewslettersService.computeAudience (defense in depth).
 * Batch-resolved in O(1) database queries without N+1 query loops.
 */
export class BillingAwareMemberAudienceRepository implements MemberAudienceRepository {
  constructor(
    private memberRepo: MemberRepository,
    private subscriptionRepo: SubscriptionRepository,
  ) {}

  async listAudienceMembers(
    filter: "all" | "paid" | "free",
    productId: string | null,
  ): Promise<AudienceMember[]> {
    // 1. Batch fetch active members and subscriptions in parallel
    const [membersRes, subsRes] = await Promise.all([
      this.memberRepo.list({ limit: 10000 }),
      this.subscriptionRepo.list({ limit: 50000 }),
    ]);

    // 2. Index active paid subscriptions by memberId
    const subsByMemberId = new Map<string, Subscription[]>();
    for (const sub of subsRes.subscriptions) {
      if (
        ["active", "trialing"].includes(sub.status) &&
        sub.amountMinor > 0
      ) {
        const list = subsByMemberId.get(sub.memberId) || [];
        list.push(sub);
        subsByMemberId.set(sub.memberId, list);
      }
    }

    const result: AudienceMember[] = [];

    // 3. Evaluate each member against subscription criteria
    for (const member of membersRes.members) {
      if (member.status !== "active") continue;

      const activeSubs = subsByMemberId.get(member.id) || [];
      const hasPaidSubscription = productId
        ? activeSubs.some((s) => s.productId === productId)
        : activeSubs.length > 0;

      if (filter === "paid" && !hasPaidSubscription) continue;
      if (filter === "free" && hasPaidSubscription) continue;

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
