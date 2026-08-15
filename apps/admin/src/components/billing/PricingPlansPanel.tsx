import React, { useState } from "react";
import {
  AdminProduct,
  AdminPlan,
  createPlanApi,
  archivePlanApi,
} from "../../lib/api";
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
import { CreditCard } from "lucide-react";

interface PricingPlansPanelProps {
  products: AdminProduct[];
  plans: AdminPlan[];
  selectedProduct: string | null;
  onSelectProduct: (productId: string) => Promise<void>;
  onError: (message: string) => void;
  onMessage: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function PricingPlansPanel({
  products,
  plans,
  selectedProduct,
  onSelectProduct,
  onError,
  onMessage,
  onChanged,
}: PricingPlansPanelProps) {
  const [planKey, setPlanKey] = useState("");
  const [planName, setPlanName] = useState("");
  const [planInterval, setPlanInterval] = useState<"month" | "year">("month");
  const [planAmount, setPlanAmount] = useState("");
  const [planTrial, setPlanTrial] = useState("0");

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) return;
    try {
      await createPlanApi({
        productId: selectedProduct,
        key: planKey,
        name: planName,
        billingType: "recurring",
        billingInterval: planInterval,
        amountMinor: parseInt(planAmount, 10) || 0,
        currency: "USD",
        trialDays: parseInt(planTrial, 10) || 0,
      });
      setPlanKey("");
      setPlanName("");
      setPlanAmount("");
      setPlanTrial("0");
      onMessage("Plan created");
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleArchivePlan = async (id: string) => {
    try {
      await archivePlanApi(id);
      onMessage("Plan archived");
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
            <CreditCard className="h-4 w-4 text-primary" /> New Pricing Plan
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreatePlan} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Select Product
              </label>
              <select
                value={selectedProduct || ""}
                onChange={(e) => onSelectProduct(e.target.value)}
                className="w-full h-8 text-xs bg-card border border-border rounded-md px-2 text-foreground font-medium"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Plan Key
              </label>
              <Input
                required
                value={planKey}
                onChange={(e) => setPlanKey(e.target.value)}
                placeholder="monthly-5"
                className="h-8 text-xs font-mono bg-card border-border"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Plan Name
              </label>
              <Input
                required
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                placeholder="Monthly $5"
                className="h-8 text-xs bg-card border-border"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Interval
                </label>
                <select
                  value={planInterval}
                  onChange={(e) =>
                    setPlanInterval(e.target.value as "month" | "year")
                  }
                  className="w-full h-8 text-xs bg-card border border-border rounded-md px-2 text-foreground"
                >
                  <option value="month">Monthly</option>
                  <option value="year">Yearly</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Amount (cents)
                </label>
                <Input
                  required
                  type="number"
                  value={planAmount}
                  onChange={(e) => setPlanAmount(e.target.value)}
                  placeholder="500"
                  className="h-8 text-xs font-mono bg-card border-border"
                />
              </div>
            </div>
            <Button
              type="submit"
              size="sm"
              className="w-full h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground mt-2"
            >
              Create Plan
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2 bg-transparent border-border shadow-2xs p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className="pl-6 text-xs">Plan Name</TableHead>
              <TableHead className="text-xs">Amount</TableHead>
              <TableHead className="text-xs">Interval</TableHead>
              <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-32 text-center text-xs text-muted-foreground"
                >
                  No plans created for this product.
                </TableCell>
              </TableRow>
            ) : (
              plans.map((pl) => (
                <TableRow
                  key={pl.id}
                  className="hover:bg-muted/40 border-border"
                >
                  <TableCell className="pl-6 font-semibold text-xs text-foreground">
                    {pl.name}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-foreground">
                    ${(pl.amountMinor / 100).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground capitalize">
                    {pl.billingInterval || "Monthly"}
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleArchivePlan(pl.id)}
                      className="h-7 px-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10"
                    >
                      Archive
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
