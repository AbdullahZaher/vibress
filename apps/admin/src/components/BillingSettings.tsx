import { useEffect, useState } from "react";
import {
  AdminProduct,
  AdminPlan,
  AdminOffer,
  listProductsApi,
  listPlansApi,
  listOffersApi,
} from "../lib/api";

import { Package, CreditCard, Percent } from "lucide-react";
import { ProductTiersPanel } from "./billing/ProductTiersPanel";
import { PricingPlansPanel } from "./billing/PricingPlansPanel";
import { DiscountOffersPanel } from "./billing/DiscountOffersPanel";

type Tab = "products" | "plans" | "offers";

export function BillingSettings() {
  const [tab, setTab] = useState<Tab>("products");
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [offers, setOffers] = useState<AdminOffer[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [p, o] = await Promise.all([
        listProductsApi(true),
        listOffersApi(),
      ]);
      setProducts(p.products);
      setOffers(o.offers);
      if (selectedProduct) {
        const plansRes = await listPlansApi(selectedProduct);
        setPlans(plansRes.plans);
      } else if (p.products.length > 0 && p.products[0]) {
        const firstId = p.products[0].id;
        setSelectedProduct(firstId);
        const plansRes = await listPlansApi(firstId);
        setPlans(plansRes.plans);
      }
      setError(null);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load billing settings",
      );
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleSelectProduct = async (prodId: string) => {
    setSelectedProduct(prodId);
    try {
      const plansRes = await listPlansApi(prodId);
      setPlans(plansRes.plans);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load plans");
    }
  };

  return (
    <div className="space-y-8 w-full max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Subscriptions & Billing
        </h1>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium">
          {error}
        </div>
      )}

      {message && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
          {message}
        </div>
      )}

      {/* Tabs Bar */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setTab("products")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === "products"
              ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Package className="h-3.5 w-3.5" /> Products & Tiers (
          {products.length})
        </button>
        <button
          onClick={() => setTab("plans")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === "plans"
              ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <CreditCard className="h-3.5 w-3.5" /> Pricing Plans ({plans.length})
        </button>
        <button
          onClick={() => setTab("offers")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === "offers"
              ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Percent className="h-3.5 w-3.5" /> Discount Offers ({offers.length})
        </button>
      </div>

      {/* Panels stay mounted so form state survives tab switches */}
      <div className={tab === "products" ? "" : "hidden"}>
        <ProductTiersPanel
          products={products}
          onError={setError}
          onMessage={setMessage}
          onChanged={refresh}
        />
      </div>
      <div className={tab === "plans" ? "" : "hidden"}>
        <PricingPlansPanel
          products={products}
          plans={plans}
          selectedProduct={selectedProduct}
          onSelectProduct={handleSelectProduct}
          onError={setError}
          onMessage={setMessage}
          onChanged={refresh}
        />
      </div>
      <div className={tab === "offers" ? "" : "hidden"}>
        <DiscountOffersPanel
          offers={offers}
          selectedProduct={selectedProduct}
          onError={setError}
          onMessage={setMessage}
          onChanged={refresh}
        />
      </div>
    </div>
  );
}
