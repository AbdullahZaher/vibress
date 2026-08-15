import React, { useState } from 'react';
import { SettingsCard } from '../SettingsCard';
import { SettingsCardRow } from '../SettingsCardRow';
import { Input } from '../../ui/input';
import { BarChart3 } from 'lucide-react';
import { Badge } from '../../ui/badge';

interface AnalyticsTrackingCardProps {
  gaId?: string | undefined;
  plausibleDomain?: string | undefined;
  posthogKey?: string | undefined;
  onChange?: ((key: 'gaId' | 'plausibleDomain' | 'posthogKey', value: string) => void) | undefined;
  isHighlighted?: boolean | undefined;
}

export const AnalyticsTrackingCard: React.FC<AnalyticsTrackingCardProps> = ({
  gaId = '',
  plausibleDomain = '',
  posthogKey = '',
  onChange,
  isHighlighted,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const activeIntegrations: string[] = [];
  if (gaId) activeIntegrations.push('GA4');
  if (plausibleDomain) activeIntegrations.push('Plausible');
  if (posthogKey) activeIntegrations.push('PostHog');

  return (
    <SettingsCard id="growth-analytics" isHighlighted={isHighlighted}>
      <SettingsCardRow
        icon={<BarChart3 className="h-4 w-4" />}
        title="Analytics & tracking"
        description="Connect Google Analytics 4, Plausible, or PostHog to measure visitor engagement."
        currentValue={
          activeIntegrations.length > 0 ? (
            <div className="flex items-center gap-1">
              {activeIntegrations.map((item) => (
                <Badge key={item} variant="secondary" className="text-xs font-mono">
                  {item}
                </Badge>
              ))}
            </div>
          ) : (
            <Badge variant="outline" className="text-xs font-mono text-muted-foreground">
              Not Configured
            </Badge>
          )
        }
        actionLabel={isExpanded ? 'Close' : 'Configure'}
        isExpanded={isExpanded}
        onAction={() => setIsExpanded(!isExpanded)}
      />

      {isExpanded && (
        <div className="border-t border-border/50 p-5 bg-muted/10 space-y-4 animate-in slide-in-from-top-2 duration-150">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="card-ga4-id" className="text-xs font-semibold text-foreground">
                Google Analytics 4 ID
              </label>
              <Input
                id="card-ga4-id"
                value={gaId}
                onChange={(e) => onChange?.('gaId', e.target.value)}
                placeholder="e.g. G-XXXXXXXXXX"
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="card-plausible-domain" className="text-xs font-semibold text-foreground">
                Plausible Domain
              </label>
              <Input
                id="card-plausible-domain"
                value={plausibleDomain}
                onChange={(e) => onChange?.('plausibleDomain', e.target.value)}
                placeholder="e.g. yoursite.com"
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="card-posthog-key" className="text-xs font-semibold text-foreground">
                PostHog API Key
              </label>
              <Input
                id="card-posthog-key"
                value={posthogKey}
                onChange={(e) => onChange?.('posthogKey', e.target.value)}
                placeholder="e.g. phc_xxxxxxxx"
                className="font-mono text-xs"
              />
            </div>
          </div>
        </div>
      )}
    </SettingsCard>
  );
};
