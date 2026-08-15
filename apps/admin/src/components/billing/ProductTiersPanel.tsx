import React, { useState } from "react";
import {
  AdminProduct,
  createProductApi,
  archiveProductApi,
} from "../../lib/api";
import { Button } from "../ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../ui/table";
import { Package } from "lucide-react";

interface ProductTiersPanelProps {
  products: AdminProduct[];
  onError: (message: string) => void;
  onMessage: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function ProductTiersPanel({
  products,
  onError,
  onMessage,
  onChanged,
}: ProductTiersPanelProps) {
  const [productKey, setProductKey] = useState("");
  const [productName, setProductName] = useState("");
  const [productDesc, setProductDesc] = useState("");

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createProductApi({
        key: productKey,
        name: productName,
        description: productDesc || null,
      });
      setProductKey("");
      setProductName("");
      setProductDesc("");
      onMessage("Product created");
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleArchiveProduct = async (id: string) => {
    try {
      await archiveProductApi(id);
      onMessage("Product archived");
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
            <Package className="h-4 w-4 text-primary" /> New Product Tier
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateProduct} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Key / Slug
              </label>
              <Input
                required
                value={productKey}
                onChange={(e) => setProductKey(e.target.value)}
                placeholder="premium-tier"
                className="h-8 text-xs font-mono bg-card border-border"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Display Name
              </label>
              <Input
                required
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="Premium Membership"
                className="h-8 text-xs bg-card border-border"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Description
              </label>
              <Input
                value={productDesc}
                onChange={(e) => setProductDesc(e.target.value)}
                placeholder="Full publication access..."
                className="h-8 text-xs bg-card border-border"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              className="w-full h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground mt-2"
            >
              Create Product Tier
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2 bg-transparent border-border shadow-2xs p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className="pl-6 text-xs">Tier Name</TableHead>
              <TableHead className="text-xs">Key</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-32 text-center text-xs text-muted-foreground"
                >
                  No products created yet.
                </TableCell>
              </TableRow>
            ) : (
              products.map((p) => (
                <TableRow
                  key={p.id}
                  className="hover:bg-muted/40 border-border"
                >
                  <TableCell className="pl-6 font-semibold text-xs text-foreground">
                    {p.name}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {p.key}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                    >
                      Active
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleArchiveProduct(p.id)}
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
