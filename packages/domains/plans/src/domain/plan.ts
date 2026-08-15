export type PlanBillingType = "free" | "recurring";
export type PlanStatus = "active" | "archived";
export type PlanVisibility = "public" | "private";

export interface Plan {
  id: string;
  productId: string;
  key: string;
  name: string;
  description: string | null;
  billingType: PlanBillingType;
  billingInterval: string | null;
  intervalCount: number;
  currency: string;
  amountMinor: number;
  trialDays: number;
  status: PlanStatus;
  visibility: PlanVisibility;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface CreatePlanData {
  id?: string | undefined;
  productId: string;
  key: string;
  name: string;
  description?: string | null | undefined;
  billingType?: PlanBillingType | undefined;
  billingInterval?: string | null | undefined;
  intervalCount?: number | undefined;
  currency?: string | undefined;
  amountMinor?: number | undefined;
  trialDays?: number | undefined;
  status?: PlanStatus | undefined;
  visibility?: PlanVisibility | undefined;
}

export interface UpdatePlanData {
  name?: string | undefined;
  description?: string | null | undefined;
  visibility?: PlanVisibility | undefined;
}

export function isValidCurrency(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

export function isValidBillingInterval(
  interval: string | null | undefined,
): boolean {
  if (!interval) return true; // free plans have no interval
  return ["month", "year"].includes(interval);
}

export const MAX_TRIAL_DAYS = 365;
export const MAX_AMOUNT_MINOR = 100_000_000; // $1M in minor units
