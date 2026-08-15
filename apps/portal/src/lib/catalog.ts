export interface PublicPlan {
  id: string;
  key: string;
  name: string;
  description: string | null;
  billingType: string;
  billingInterval: string | null;
  intervalCount: number;
  currency: string;
  amountMinor: number;
  trialDays: number;
}

export interface PublicProduct {
  id: string;
  key: string;
  name: string;
  description: string | null;
  plans: PublicPlan[];
}

export async function fetchProducts(): Promise<PublicProduct[]> {
  const res = await fetch("/api/content/v1/products");
  if (!res.ok) throw new Error("Failed to load plans");
  const data = await res.json();
  return data.products as PublicProduct[];
}

export function formatPrice(plan: PublicPlan): string {
  if (plan.billingType === "free") return "Free";
  const amount = plan.amountMinor / 100;
  const symbol =
    plan.currency === "USD"
      ? "$"
      : plan.currency === "SAR"
        ? "SAR "
        : `${plan.currency} `;
  const interval = plan.billingInterval === "year" ? "/year" : "/month";
  return `${symbol}${amount.toFixed(2)}${interval}`;
}
