import React, { useState } from 'react';
import { SettingsCard } from '../SettingsCard';
import { SettingsCardRow } from '../SettingsCardRow';
import { Input } from '../../ui/input';
import { Lock, Unlock } from 'lucide-react';
import { Badge } from '../../ui/badge';

interface SitePrivacyCardProps {
  isPrivate?: boolean | undefined;
  password?: string | undefined;
  onChange?: ((key: 'isPrivate' | 'password', value: unknown) => void) | undefined;
  isHighlighted?: boolean | undefined;
}

export const SitePrivacyCard: React.FC<SitePrivacyCardProps> = ({
  isPrivate = false,
  password = '',
  onChange,
  isHighlighted,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <SettingsCard id="general-privacy" isHighlighted={isHighlighted}>
      <SettingsCardRow
        icon={<Lock className="h-4 w-4" />}
        title="Make this site private"
        description="Enable password protection to restrict access to your publication during staging or private launches."
        currentValue={
          isPrivate ? (
            <Badge variant="destructive" className="text-[10px] gap-1 px-2 py-0.5">
              <Lock className="h-3 w-3" /> Password Protected
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] gap-1 px-2 py-0.5 text-muted-foreground">
              <Unlock className="h-3 w-3 text-emerald-500" /> Public Access
            </Badge>
          )
        }
        actionLabel={isExpanded ? 'Close' : 'Configure'}
        isExpanded={isExpanded}
        onAction={() => setIsExpanded(!isExpanded)}
      />

      {isExpanded && (
        <div className="border-t border-border/50 p-5 bg-muted/10 space-y-4 animate-in slide-in-from-top-2 duration-150">
          <div className="flex items-start justify-between gap-4 p-3.5 rounded-lg border border-border/50 bg-card">
            <div>
              <p className="text-xs font-semibold text-foreground">Enable site password protection</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                All public routes will be locked behind a password screen. Search engines will not index content.
              </p>
            </div>
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => onChange?.('isPrivate', e.target.checked)}
              className="size-4 rounded border-border text-primary focus:ring-primary mt-1 cursor-pointer"
            />
          </div>

          {isPrivate && (
            <div className="space-y-1.5 max-w-sm pt-1 animate-in fade-in duration-150">
              <label htmlFor="card-private-pass" className="text-xs font-semibold text-foreground">
                Set or update site password
              </label>
              <Input
                id="card-private-pass"
                type="password"
                value={password}
                onChange={(e) => onChange?.('password', e.target.value)}
                placeholder="Min 6 characters"
                className="bg-card text-xs h-8.5"
              />
              <p className="text-[10px] text-muted-foreground">Password will be securely hashed with Argon2id on save.</p>
            </div>
          )}
        </div>
      )}
    </SettingsCard>
  );
};
