import React from "react";
import { Button } from "../ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useAdminLocale } from "../../lib/admin-locale";

export interface SettingsCardRowProps {
  icon?: React.ReactNode | undefined;
  title: string;
  description?: string | undefined;
  /** Legacy value summaries are intentionally hidden beside row actions. */
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
  actionLabel = "Edit",
  actionVariant = "outline",
  isExpanded,
  onAction,
  disabled = false,
}) => {
  const { tr } = useAdminLocale();
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
            {tr(title)}
          </h4>
          {description && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {tr(description)}
            </p>
          )}
        </div>
      </div>

      {onAction && (
        <div className="flex min-w-0 items-center justify-end border-t border-border/40 pt-3 sm:shrink-0 sm:border-0 sm:pt-0">
          <Button
            type="button"
            size="sm"
            variant={actionVariant}
            onClick={onAction}
            disabled={disabled}
            aria-expanded={isExpanded}
            className="min-h-11 shrink-0 gap-1.5 px-4 text-sm"
          >
            <span>{tr(actionLabel)}</span>
            {isExpanded !== undefined &&
              (isExpanded ? (
                <ChevronUp className="size-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="size-3.5" aria-hidden="true" />
              ))}
          </Button>
        </div>
      )}
    </div>
  );
};
