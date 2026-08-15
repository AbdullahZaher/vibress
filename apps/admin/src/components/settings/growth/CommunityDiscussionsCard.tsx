import React, { useState } from 'react';
import { SettingsCard } from '../SettingsCard';
import { SettingsCardRow } from '../SettingsCardRow';
import { MessageSquare } from 'lucide-react';
import { Badge } from '../../ui/badge';

interface CommunityDiscussionsCardProps {
  commentAccess?: ('all' | 'paid' | 'disabled') | undefined;
  preModeration?: boolean | undefined;
  onChange?: ((key: 'commentAccess' | 'preModeration', value: unknown) => void) | undefined;
  isHighlighted?: boolean | undefined;
}

export const CommunityDiscussionsCard: React.FC<CommunityDiscussionsCardProps> = ({
  commentAccess = 'all',
  preModeration = false,
  onChange,
  isHighlighted,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getLabel = () => {
    if (commentAccess === 'all') return 'All Members';
    if (commentAccess === 'paid') return 'Paid Members Only';
    return 'Disabled';
  };

  return (
    <SettingsCard id="growth-community" isHighlighted={isHighlighted}>
      <SettingsCardRow
        icon={<MessageSquare className="h-4 w-4" />}
        title="Comments & moderation"
        description="Enable reader discussions on published stories and set moderation filters."
        currentValue={
          <Badge variant="secondary" className="text-xs font-mono">
            {getLabel()}
          </Badge>
        }
        actionLabel={isExpanded ? 'Close' : 'Configure'}
        isExpanded={isExpanded}
        onAction={() => setIsExpanded(!isExpanded)}
      />

      {isExpanded && (
        <div className="border-t border-border/50 p-5 bg-muted/10 space-y-4 animate-in slide-in-from-top-2 duration-150">
          <div className="space-y-1.5 max-w-sm">
            <label htmlFor="card-comment-access" className="text-xs font-semibold text-foreground">
              Who can comment on posts
            </label>
            <select
              id="card-comment-access"
              value={commentAccess}
              onChange={(e) => onChange?.('commentAccess', e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="all">All registered members (Free & Paid)</option>
              <option value="paid">Paid subscribers only</option>
              <option value="disabled">Disabled (No comments)</option>
            </select>
          </div>

          <div className="flex items-start justify-between gap-4 p-3.5 rounded-lg border border-border/50 bg-card">
            <div>
              <p className="text-xs font-semibold text-foreground">Pre-moderate new member comments</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Require manual approval from staff before comments appear publicly.
              </p>
            </div>
            <input
              type="checkbox"
              checked={preModeration}
              onChange={(e) => onChange?.('preModeration', e.target.checked)}
              className="size-4 rounded border-border text-primary focus:ring-primary mt-1 cursor-pointer"
            />
          </div>
        </div>
      )}
    </SettingsCard>
  );
};
