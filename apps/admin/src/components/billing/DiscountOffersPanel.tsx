import React, { useState } from "react";
import { AdminOffer, createOfferApi, disableOfferApi } from "../../lib/api";
import { Button } from "../ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { Input } from "../ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../ui/table";
import { Percent } from "lucide-react";

interface DiscountOffersPanelProps {
  offers: AdminOffer[];
  selectedProduct: string | null;
  onError: (message: string) => void;
  onMessage: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function DiscountOffersPanel({
  offers,
  selectedProduct,
  onError,
  onMessage,
  onChanged,
}: DiscountOffersPanelProps) {
  const [offerKey, setOfferKey] = useState("");
  const [offerName, setOfferName] = useState("");
  const [offerType] = useState<"percentage" | "fixed_amount">("percentage");
  const [offerValue, setOfferValue] = useState("");

  const handleCreateOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) return;
    try {
      await createOfferApi({
        productId: selectedProduct,
        key: offerKey,
        name: offerName,
        discountType: offerType,
        discountValue: parseInt(offerValue, 10) || 0,
      });
      setOfferKey("");
      setOfferName("");
      setOfferValue("");
      onMessage("Offer created");
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleDisableOffer = async (id: string) => {
    try {
      await disableOfferApi(id);
      onMessage("Offer disabled");
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-1 h-fit bg-transparent border-border shadow-2xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
            <Percent className="h-4 w-4 text-primary" /> New Discount Offer
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateOffer} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Offer Code
              </label>
              <Input
                required
                value={offerKey}
                onChange={(e) => setOfferKey(e.target.value)}
                placeholder="LAUNCH20"
                className="h-8 text-xs font-mono bg-card border-border"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Offer Name
              </label>
              <Input
                required
                value={offerName}
                onChange={(e) => setOfferName(e.target.value)}
                placeholder="Launch 20% Off"
                className="h-8 text-xs bg-card border-border"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Discount Value (%)
              </label>
              <Input
                required
                type="number"
                value={offerValue}
                onChange={(e) => setOfferValue(e.target.value)}
                placeholder="20"
                className="h-8 text-xs font-mono bg-card border-border"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              className="w-full h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground mt-2"
            >
              Create Offer
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2 bg-transparent border-border shadow-2xs p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className="pl-6 text-xs">Offer Name</TableHead>
              <TableHead className="text-xs">Code</TableHead>
              <TableHead className="text-xs">Discount</TableHead>
              <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {offers.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-32 text-center text-xs text-muted-foreground"
                >
                  No active offers.
                </TableCell>
              </TableRow>
            ) : (
              offers.map((off) => (
                <TableRow
                  key={off.id}
                  className="hover:bg-muted/40 border-border"
                >
                  <TableCell className="pl-6 font-semibold text-xs text-foreground">
                    {off.name}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-foreground">
                    {off.key}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-emerald-500 font-semibold">
                    {off.discountValue}% Off
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDisableOffer(off.id)}
                      className="h-7 px-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10"
                    >
                      Disable
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
