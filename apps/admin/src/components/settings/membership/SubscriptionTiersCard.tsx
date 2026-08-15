import React, { useState, useEffect } from 'react';
import { SettingsCard } from '../SettingsCard';
import { SettingsCardRow } from '../SettingsCardRow';
import { SettingsModalPortal } from '../SettingsModalPortal';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Input } from '../../ui/input';
import { CreditCard, CheckCircle2, Plus, X, RefreshCw } from 'lucide-react';
import { listProductsApi, createProductApi, AdminProduct } from '../../../lib/api/billing';

interface SubscriptionTiersCardProps {
  currency?: string | undefined;
  isHighlighted?: boolean | undefined;
}

export const SubscriptionTiersCard: React.FC<SubscriptionTiersCardProps> = ({
  currency = 'USD',
  isHighlighted,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProducts = async () => {
    setLoading(true);
    try {
      const res = await listProductsApi();
      setProducts(res.products || []);
    } catch {
      // Keep state
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  const handleOpen = () => {
    setIsModalOpen(true);
    loadProducts();
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey || !newName) return;
    setSaving(true);
    setError(null);
    try {
      await createProductApi({
        key: newKey.toLowerCase().trim().replace(/\s+/g, '-'),
        name: newName.trim(),
        description: newDesc.trim() || null,
      });
      setIsCreating(false);
      setNewKey('');
      setNewName('');
      setNewDesc('');
      loadProducts();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create tier');
    } finally {
      setSaving(false);
    }
  };

  const activeCount = products.length || 1;

  return (
    <>
      <SettingsCard id="membership-tiers" isHighlighted={isHighlighted}>
        <SettingsCardRow
          icon={<CreditCard className="h-4 w-4" />}
          title="Membership tiers & Stripe billing"
          description="Set up subscription tiers and connect Stripe to accept recurring paid memberships."
          currentValue={
            <div className="flex items-center gap-1.5 font-mono text-xs">
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Stripe Connected
              </Badge>
              <span className="text-muted-foreground">•</span>
              <span className="text-foreground font-semibold">{activeCount} {activeCount === 1 ? 'Tier' : 'Tiers'} ({currency})</span>
            </div>
          }
          actionLabel="Manage tiers"
          onAction={handleOpen}
        />
      </SettingsCard>

      {/* Subscription Tiers & Billing Modal */}
      <SettingsModalPortal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-2xl bg-card border border-border/80 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-5 border-b border-border/60 bg-muted/20">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">Membership Tiers & Stripe Billing</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-foreground">Active Publication Tiers</h4>
                  {loading && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
                </div>

                <div className="divide-y divide-border/40 rounded-xl border border-border/60 bg-muted/10 overflow-hidden max-h-56 overflow-y-auto">
                  {products.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">No subscription tiers created yet.</div>
                  ) : (
                    products.map((prod) => (
                      <div key={prod.id} className="p-3 flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-foreground">{prod.name}</span>
                            <Badge variant={prod.status === 'active' ? 'default' : 'secondary'} className="text-[10px] font-mono capitalize">
                              {prod.status}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground">{prod.description || 'No description'}</p>
                        </div>
                        <span className="text-xs font-mono text-muted-foreground">{prod.key}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive text-xs">
                  {error}
                </div>
              )}

              {isCreating ? (
                <form onSubmit={handleCreateProduct} className="space-y-3 p-4 rounded-xl border border-primary/30 bg-primary/5">
                  <h5 className="text-xs font-bold text-foreground">Add New Tier</h5>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Tier Name (e.g. Premium VIP)"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="text-xs h-8 bg-background"
                      required
                    />
                    <Input
                      placeholder="Slug Key (e.g. premium-vip)"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      className="text-xs h-8 font-mono bg-background"
                      required
                    />
                  </div>
                  <Input
                    placeholder="Short description of tier benefits"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    className="text-xs h-8 bg-background"
                  />
                  <div className="flex justify-end gap-2 pt-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setIsCreating(false)} className="text-xs h-8 cursor-pointer">
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={saving} className="text-xs h-8 cursor-pointer">
                      {saving ? 'Creating...' : 'Save Tier'}
                    </Button>
                  </div>
                </form>
              ) : (
                <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => setIsCreating(true)}>
                  <Plus className="h-3 w-3" /> Add New Tier
                </Button>
              )}
            </div>
          </div>
        </div>
      </SettingsModalPortal>
    </>
  );
};
