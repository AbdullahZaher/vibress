import React, { useState, useEffect } from "react";
import { SettingsCard } from "../SettingsCard";
import { SettingsCardRow } from "../SettingsCardRow";
import { SettingsModalPortal } from "../SettingsModalPortal";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Tag, Plus, X, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "../../ui/badge";
import {
  listOffersApi,
  createOfferApi,
  disableOfferApi,
  listProductsApi,
  AdminOffer,
  AdminProduct,
} from "../../../lib/api/billing";

interface OffersPromotionsCardProps {
  isHighlighted?: boolean | undefined;
}

export const OffersPromotionsCard: React.FC<OffersPromotionsCardProps> = ({
  isHighlighted,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [offers, setOffers] = useState<AdminOffer[]>([]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [discountValue, setDiscountValue] = useState(20);
  const [discountType, setDiscountType] = useState<
    "percentage" | "fixed_amount"
  >("percentage");
  const [productId, setProductId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [offersRes, productsRes] = await Promise.all([
        listOffersApi().catch(() => ({ offers: [] })),
        listProductsApi().catch(() => ({ products: [] })),
      ]);
      setOffers(offersRes.offers || []);
      setProducts(productsRes.products || []);
      if (
        productsRes.products &&
        productsRes.products.length > 0 &&
        !productId
      ) {
        setProductId(productsRes.products[0]!.id);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpen = () => {
    setIsModalOpen(true);
    loadData();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !key) return;
    setSaving(true);
    setError(null);
    try {
      const targetProductId = productId || products[0]?.id || "default-product";
      await createOfferApi({
        productId: targetProductId,
        name: name.trim(),
        key: key.toLowerCase().trim().replace(/\s+/g, "-"),
        discountType,
        discountValue: Number(discountValue) || 10,
        durationType: "once",
      });
      setIsCreating(false);
      setName("");
      setKey("");
      loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create offer");
    } finally {
      setSaving(false);
    }
  };

  const handleDisable = async (id: string) => {
    try {
      await disableOfferApi(id);
      loadData();
    } catch {
      // Keep state
    }
  };

  const activeOffersCount = offers.filter((o) => o.status === "active").length;

  return (
    <>
      <SettingsCard id="membership-offers" isHighlighted={isHighlighted}>
        <SettingsCardRow
          icon={<Tag className="h-4 w-4" />}
          title="Offers & promotions"
          description="Create discount codes and special introductory offers to accelerate member acquisition."
          currentValue={
            <Badge
              variant="outline"
              className="text-xs font-mono text-muted-foreground"
            >
              {activeOffersCount} Active{" "}
              {activeOffersCount === 1 ? "Offer" : "Offers"}
            </Badge>
          }
          actionLabel="Manage offers"
          onAction={handleOpen}
        />
      </SettingsCard>

      {/* Offers & Discounts Modal */}
      <SettingsModalPortal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      >
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-card border border-border/80 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-5 border-b border-border/60 bg-muted/20">
              <div className="flex items-center gap-2">
                <Tag className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">
                  Offers & Discounts
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-foreground">
                    Promotional Campaign Codes
                  </h4>
                  {loading && (
                    <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                </div>

                <div className="divide-y divide-border/40 rounded-xl border border-border/60 bg-muted/10 overflow-hidden max-h-52 overflow-y-auto">
                  {offers.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      No active discount codes.
                    </div>
                  ) : (
                    offers.map((offer) => (
                      <div
                        key={offer.id}
                        className="p-3 flex items-center justify-between"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-foreground">
                              {offer.name}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-[10px] font-mono uppercase bg-background"
                            >
                              {offer.key}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            {offer.discountValue}
                            {offer.discountType === "percentage"
                              ? "%"
                              : "$"}{" "}
                            off
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDisable(offer.id)}
                          className="h-7 px-2 text-muted-foreground hover:text-destructive cursor-pointer"
                          title="Deactivate offer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {isCreating ? (
                <form
                  onSubmit={handleCreate}
                  className="space-y-3 p-4 rounded-xl border border-primary/40 bg-primary/5"
                >
                  <h4 className="text-xs font-bold text-foreground">
                    New Discount Code
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Campaign Name (e.g. Summer Launch)"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="text-xs h-8.5 bg-card"
                      required
                    />
                    <Input
                      placeholder="Promo Code (e.g. SUMMER20)"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      className="text-xs h-8.5 bg-card font-mono uppercase"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      placeholder="Discount Amount"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(Number(e.target.value))}
                      className="text-xs h-8.5 bg-card"
                      required
                    />
                    <select
                      value={discountType}
                      onChange={(e) =>
                        setDiscountType(
                          e.target.value as "percentage" | "fixed_amount",
                        )
                      }
                      className="h-8.5 rounded-md border border-input bg-background px-3 text-xs ring-offset-background"
                    >
                      <option value="percentage">% Percentage</option>
                      <option value="fixed_amount">$ Fixed Amount</option>
                    </select>
                  </div>
                  {error && (
                    <p className="text-xs text-destructive font-medium">
                      {error}
                    </p>
                  )}
                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setIsCreating(false)}
                      className="text-xs h-8 cursor-pointer"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={saving}
                      className="text-xs h-8 cursor-pointer"
                    >
                      {saving ? "Creating..." : "Create Offer"}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex justify-end pt-2 border-t border-border/40">
                  <Button
                    size="sm"
                    onClick={() => setIsCreating(true)}
                    className="gap-1.5 text-xs cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" /> Create New Offer
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </SettingsModalPortal>
    </>
  );
};
