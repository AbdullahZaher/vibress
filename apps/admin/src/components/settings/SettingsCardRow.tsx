import React from 'react';
import { Button } from '../ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';

export interface SettingsCardRowProps {
  icon?: React.ReactNode | undefined;
  title: string;
  description?: string | undefined;
  currentValue?: React.ReactNode | undefined;
  actionLabel?: string | undefined;
  actionVariant?: ('default' | 'outline' | 'ghost' | 'secondary' | 'destructive') | undefined;
  isExpanded?: boolean | undefined;
  onAction?: (() => void) | undefined;
  disabled?: boolean | undefined;
}

export const SettingsCardRow: React.FC<SettingsCardRowProps> = ({
  icon,
  title,
  description,
  currentValue,
  actionLabel = 'Edit',
  actionVariant = 'outline',
  isExpanded,
  onAction,
  disabled = false,
}) => {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 transition-colors">
      <div className="flex items-start gap-3.5 max-w-xl">
        {icon && (
          <div className="size-8 rounded-lg bg-muted/60 text-muted-foreground flex items-center justify-center shrink-0 mt-0.5 border border-border/40">
            {icon}
          </div>
        )}
        <div className="space-y-0.5">
          <h4 className="text-sm font-semibold text-foreground tracking-tight">{title}</h4>
          {description && (
            <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border/30">
        {currentValue && (
          <div className="text-xs font-medium text-muted-foreground text-right">
            {currentValue}
          </div>
        )}

        {onAction && (
          <Button
            type="button"
            size="sm"
            variant={actionVariant}
            onClick={onAction}
            disabled={disabled}
            className="h-8 text-xs font-semibold px-3 cursor-pointer shrink-0 gap-1.5 transition-all bg-card/80 hover:bg-muted/80 border-border/80 text-foreground"
          >
            <span>{actionLabel}</span>
            {isExpanded !== undefined && (
              isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
};
