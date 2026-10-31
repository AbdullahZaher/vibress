import React from "react";
import { Button } from "../ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";

export interface SettingsCardRowProps {
  icon?: React.ReactNode | undefined;
  title: string;
  description?: string | undefined;
  currentValue?: React.ReactNode | undefined;
  actionLabel?: string | undefined;
  actionVariant?:
    ("default" | "outline" | "ghost" | "secondary" | "destructive") | undefined;
  isExpanded?: boolean | undefined;
  onAction?: (() => void) | undefined;
  disabled?: boolean | undefined;
}

export const SettingsCardRow: React.FC<SettingsCardRowProps> = ({
  icon,
  title,
  description,
  currentValue,
  actionLabel = "Edit",
  actionVariant = "outline",
  isExpanded,
  onAction,
  disabled = false,
}) => {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-4 px-4 py-4 transition-colors sm:flex-row sm:items-center sm:px-5">
      <div className="flex min-w-0 max-w-2xl items-start gap-3">
        {icon && (
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground">
            {icon}
          </div>
        )}
        <div className="min-w-0 space-y-1">
          <h4 className="text-sm font-semibold text-foreground tracking-tight">
            {title}
          </h4>
          {description && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-border/40 pt-3 sm:shrink-0 sm:justify-end sm:border-t-0 sm:pt-0">
        {currentValue && (
          <div className="min-w-0 break-words text-end text-sm font-medium text-muted-foreground">
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
            className="min-h-10 shrink-0 gap-1.5 px-3 text-sm"
          >
            <span>{actionLabel}</span>
            {isExpanded !== undefined &&
              (isExpanded ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              ))}
          </Button>
        )}
      </div>
    </div>
  );
};
