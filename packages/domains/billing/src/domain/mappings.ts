export type BillingProviderName = string;

export interface BillingCustomer {
  id: string;
  memberId: string;
  provider: string;
  providerCustomerId: string;
}

export interface CreateBillingCustomerData {
  memberId: string;
  provider: string;
  providerCustomerId: string;
}

export interface BillingCustomerRepository {
  findOrCreate(data: CreateBillingCustomerData): Promise<BillingCustomer>;
  findByMemberId(
    memberId: string,
    provider: string,
  ): Promise<BillingCustomer | null>;
}

export interface BillingPlanMapping {
  id: string;
  planId: string;
  provider: string;
  providerProductId: string;
  providerPriceId: string;
}

export interface BillingPlanMappingRepository {
  upsert(data: {
    planId: string;
    provider: string;
    providerProductId: string;
    providerPriceId: string;
  }): Promise<BillingPlanMapping>;
  findByPlanId(
    planId: string,
    provider: string,
  ): Promise<BillingPlanMapping | null>;
}
