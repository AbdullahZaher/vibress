import React, { useEffect, useState } from 'react';
import {
  AdminProduct,
  AdminPlan,
  AdminOffer,
  listProductsApi,
  createProductApi,
  archiveProductApi,
  listPlansApi,
  createPlanApi,
  archivePlanApi,
  listOffersApi,
  createOfferApi,
  disableOfferApi,
} from '../lib/api';

import { Button } from './ui/button';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/table';
import { CreditCard, Package, Percent } from 'lucide-react';

type Tab = 'products' | 'plans' | 'offers';

export function BillingSettings() {
  const [tab, setTab] = useState<Tab>('products');
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [offers, setOffers] = useState<AdminOffer[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Forms
  const [productKey, setProductKey] = useState('');
  const [productName, setProductName] = useState('');
  const [productDesc, setProductDesc] = useState('');

  const [planKey, setPlanKey] = useState('');
  const [planName, setPlanName] = useState('');
  const [planInterval, setPlanInterval] = useState<'month' | 'year'>('month');
  const [planAmount, setPlanAmount] = useState('');
  const [planTrial, setPlanTrial] = useState('0');

  const [offerKey, setOfferKey] = useState('');
  const [offerName, setOfferName] = useState('');
  const [offerType] = useState<'percentage' | 'fixed_amount'>('percentage');
  const [offerValue, setOfferValue] = useState('');

  const refresh = async () => {
    try {
      const [p, o] = await Promise.all([listProductsApi(true), listOffersApi()]);
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
      setError(err instanceof Error ? err.message : 'Failed to load billing settings');
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
      setError(err instanceof Error ? err.message : 'Failed to load plans');
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createProductApi({ key: productKey, name: productName, description: productDesc || null });
      setProductKey('');
      setProductName('');
      setProductDesc('');
      setMessage('Product created');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleArchiveProduct = async (id: string) => {
    try {
      await archiveProductApi(id);
      setMessage('Product archived');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) return;
    try {
      await createPlanApi({
        productId: selectedProduct,
        key: planKey,
        name: planName,
        billingType: 'recurring',
        billingInterval: planInterval,
        amountMinor: parseInt(planAmount, 10) || 0,
        currency: 'USD',
        trialDays: parseInt(planTrial, 10) || 0,
      });
      setPlanKey('');
      setPlanName('');
      setPlanAmount('');
      setPlanTrial('0');
      setMessage('Plan created');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleArchivePlan = async (id: string) => {
    try {
      await archivePlanApi(id);
      setMessage('Plan archived');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

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
      setOfferKey('');
      setOfferName('');
      setOfferValue('');
      setMessage('Offer created');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleDisableOffer = async (id: string) => {
    try {
      await disableOfferApi(id);
      setMessage('Offer disabled');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <div className="space-y-8 w-full max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">Subscriptions & Billing</h1>
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
          onClick={() => setTab('products')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === 'products'
              ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Package className="h-3.5 w-3.5" /> Products & Tiers ({products.length})
        </button>
        <button
          onClick={() => setTab('plans')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === 'plans'
              ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <CreditCard className="h-3.5 w-3.5" /> Pricing Plans ({plans.length})
        </button>
        <button
          onClick={() => setTab('offers')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === 'offers'
              ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Percent className="h-3.5 w-3.5" /> Discount Offers ({offers.length})
        </button>
      </div>

      {/* Tab 1: Products */}
      {tab === 'products' && (
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
                  <label className="text-xs font-medium text-foreground">Key / Slug</label>
                  <Input required value={productKey} onChange={(e) => setProductKey(e.target.value)} placeholder="premium-tier" className="h-8 text-xs font-mono bg-card border-border" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Display Name</label>
                  <Input required value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Premium Membership" className="h-8 text-xs bg-card border-border" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Description</label>
                  <Input value={productDesc} onChange={(e) => setProductDesc(e.target.value)} placeholder="Full publication access..." className="h-8 text-xs bg-card border-border" />
                </div>
                <Button type="submit" size="sm" className="w-full h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground mt-2">
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
                    <TableCell colSpan={4} className="h-32 text-center text-xs text-muted-foreground">
                      No products created yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  products.map((p) => (
                    <TableRow key={p.id} className="hover:bg-muted/40 border-border">
                      <TableCell className="pl-6 font-semibold text-xs text-foreground">{p.name}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{p.key}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
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
      )}

      {/* Tab 2: Plans */}
      {tab === 'plans' && (
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
                  <label className="text-xs font-medium text-foreground">Select Product</label>
                  <select
                    value={selectedProduct || ''}
                    onChange={(e) => handleSelectProduct(e.target.value)}
                    className="w-full h-8 text-xs bg-card border border-border rounded-md px-2 text-foreground font-medium"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Plan Key</label>
                  <Input required value={planKey} onChange={(e) => setPlanKey(e.target.value)} placeholder="monthly-5" className="h-8 text-xs font-mono bg-card border-border" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Plan Name</label>
                  <Input required value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="Monthly $5" className="h-8 text-xs bg-card border-border" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">Interval</label>
                    <select
                      value={planInterval}
                      onChange={(e) => setPlanInterval(e.target.value as 'month' | 'year')}
                      className="w-full h-8 text-xs bg-card border border-border rounded-md px-2 text-foreground"
                    >
                      <option value="month">Monthly</option>
                      <option value="year">Yearly</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">Amount (cents)</label>
                    <Input required type="number" value={planAmount} onChange={(e) => setPlanAmount(e.target.value)} placeholder="500" className="h-8 text-xs font-mono bg-card border-border" />
                  </div>
                </div>
                <Button type="submit" size="sm" className="w-full h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground mt-2">
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
                    <TableCell colSpan={4} className="h-32 text-center text-xs text-muted-foreground">
                      No plans created for this product.
                    </TableCell>
                  </TableRow>
                ) : (
                  plans.map((pl) => (
                    <TableRow key={pl.id} className="hover:bg-muted/40 border-border">
                      <TableCell className="pl-6 font-semibold text-xs text-foreground">{pl.name}</TableCell>
                      <TableCell className="text-xs font-mono text-foreground">${(pl.amountMinor / 100).toFixed(2)}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground capitalize">{pl.billingInterval || 'Monthly'}</TableCell>
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
      )}

      {/* Tab 3: Offers */}
      {tab === 'offers' && (
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
                  <label className="text-xs font-medium text-foreground">Offer Code</label>
                  <Input required value={offerKey} onChange={(e) => setOfferKey(e.target.value)} placeholder="LAUNCH20" className="h-8 text-xs font-mono bg-card border-border" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Offer Name</label>
                  <Input required value={offerName} onChange={(e) => setOfferName(e.target.value)} placeholder="Launch 20% Off" className="h-8 text-xs bg-card border-border" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Discount Value (%)</label>
                  <Input required type="number" value={offerValue} onChange={(e) => setOfferValue(e.target.value)} placeholder="20" className="h-8 text-xs font-mono bg-card border-border" />
                </div>
                <Button type="submit" size="sm" className="w-full h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground mt-2">
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
                    <TableCell colSpan={4} className="h-32 text-center text-xs text-muted-foreground">
                      No active offers.
                    </TableCell>
                  </TableRow>
                ) : (
                  offers.map((off) => (
                    <TableRow key={off.id} className="hover:bg-muted/40 border-border">
                      <TableCell className="pl-6 font-semibold text-xs text-foreground">{off.name}</TableCell>
                      <TableCell className="text-xs font-mono text-foreground">{off.key}</TableCell>
                      <TableCell className="text-xs font-mono text-emerald-500 font-semibold">{off.discountValue}% Off</TableCell>
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
      )}
    </div>
  );
}
