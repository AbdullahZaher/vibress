import React, { useState, useEffect } from 'react';
import { CreditCard, ShieldCheck, Users, RefreshCw, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';
import { BillingSettings } from './BillingSettings';
import { SubscriptionsList } from './SubscriptionsList';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { getStaffSettingsApi, updateSettingApi } from '../lib/api/operations';

interface MembershipSettingsProps {
  initialTab?: 'billing' | 'access' | 'subscriptions';
}

const MemberAccessPanel: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [signupEnabled, setSignupEnabled] = useState(true);
  const [defaultNewsletterOptIn, setDefaultNewsletterOptIn] = useState(false);
  const [memberSessionTtlHours, setMemberSessionTtlHours] = useState(720);

  useEffect(() => {
    getStaffSettingsApi()
      .then((res) => {
        for (const ns of res.namespaces) {
          if (ns.namespace === 'members') {
            for (const s of ns.settings) {
              if (s.key === 'signupEnabled') setSignupEnabled(Boolean(s.value));
              if (s.key === 'defaultNewsletterOptIn') setDefaultNewsletterOptIn(Boolean(s.value));
            }
          }
          if (ns.namespace === 'security') {
            for (const s of ns.settings) {
              if (s.key === 'memberSessionTtlHours') setMemberSessionTtlHours(Number(s.value ?? 720));
            }
          }
        }
      })
      .catch((err: unknown) => {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load membership settings');
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      await Promise.all([
        updateSettingApi('members', 'signupEnabled', signupEnabled),
        updateSettingApi('members', 'defaultNewsletterOptIn', defaultNewsletterOptIn),
        updateSettingApi('security', 'memberSessionTtlHours', Number(memberSessionTtlHours)),
      ]);
      setSuccessMsg('Membership access settings saved.');
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <RefreshCw className="h-5 w-5 animate-spin mr-2" />
        <span>Loading access configuration...</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {successMsg && (
        <div className="flex items-center gap-2 p-3.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 rounded-xl text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-2 p-3.5 bg-destructive/10 border border-destructive/30 text-destructive rounded-xl text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <Card className="border-border/60 bg-card shadow-xs">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Registration & Portal Access
          </CardTitle>
          <CardDescription>
            Control how members join your publication and configure authentication session lifetimes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start justify-between gap-4 p-3.5 rounded-lg border border-border/50 bg-background/50">
            <div>
              <p className="text-sm font-semibold text-foreground">Allow Member Signups</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                When enabled, visitors can subscribe and register accounts through the public portal.
              </p>
            </div>
            <input
              type="checkbox"
              checked={signupEnabled}
              onChange={(e) => setSignupEnabled(e.target.checked)}
              className="size-4.5 rounded border-border text-primary focus:ring-primary mt-1 cursor-pointer"
            />
          </div>

          <div className="flex items-start justify-between gap-4 p-3.5 rounded-lg border border-border/50 bg-background/50">
            <div>
              <p className="text-sm font-semibold text-foreground">Default Newsletter Opt-in</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Automatically subscribe newly registered members to default email newsletters.
              </p>
            </div>
            <input
              type="checkbox"
              checked={defaultNewsletterOptIn}
              onChange={(e) => setDefaultNewsletterOptIn(e.target.checked)}
              className="size-4.5 rounded border-border text-primary focus:ring-primary mt-1 cursor-pointer"
            />
          </div>

          <div className="space-y-1.5 pt-2">
            <label htmlFor="session-ttl" className="text-xs font-semibold text-foreground">
              Member Session Lifetime (Hours)
            </label>
            <Input
              id="session-ttl"
              type="number"
              min={1}
              max={8760}
              value={memberSessionTtlHours}
              onChange={(e) => setMemberSessionTtlHours(parseInt(e.target.value, 10) || 720)}
              className="max-w-xs"
              required
            />
            <p className="text-[11px] text-muted-foreground">Default is 720 hours (30 days) before re-authentication is required.</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving} className="gap-2 cursor-pointer">
          {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {saving ? 'Saving...' : 'Save Access Settings'}
        </Button>
      </div>
    </form>
  );
};

export const MembershipSettings: React.FC<MembershipSettingsProps> = ({ initialTab = 'billing' }) => {
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  return (
    <div className="space-y-6 w-full max-w-6xl mx-auto">
      {/* Header with Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <CreditCard className="h-6 w-6 text-primary" />
            Membership & Monetization
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure member registration, subscription tiers, Stripe payment gateways, and member access.
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
          <TabsList className="bg-muted/80 p-1">
            <TabsTrigger value="billing" className="gap-2 text-xs">
              <CreditCard className="h-3.5 w-3.5" />
              Tiers & Billing
            </TabsTrigger>
            <TabsTrigger value="access" className="gap-2 text-xs">
              <ShieldCheck className="h-3.5 w-3.5" />
              Access & Signups
            </TabsTrigger>
            <TabsTrigger value="subscriptions" className="gap-2 text-xs">
              <Users className="h-3.5 w-3.5" />
              Subscribers
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Tabs Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsContent value="billing" className="mt-0">
          <BillingSettings />
        </TabsContent>

        <TabsContent value="access" className="mt-0">
          <MemberAccessPanel />
        </TabsContent>

        <TabsContent value="subscriptions" className="mt-0">
          <SubscriptionsList />
        </TabsContent>
      </Tabs>
    </div>
  );
};
