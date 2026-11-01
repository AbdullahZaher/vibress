import React from "react";
import { Button } from "../ui/button";
import { ChevronDown } from "lucide-react";
import { useAdminLocale } from "../../lib/admin-locale";

export interface SettingsCardRowProps {
  icon?: React.ReactNode | undefined;
  title: string;
  description?: string | undefined;
  /** Kept for existing consumers; summaries are intentionally not shown beside actions. */
  currentValue?: React.ReactNode | undefined;
  actionLabel?: string | undefined;
  actionVariant?:
    ("default" | "outline" | "ghost" | "secondary" | "destructive") | undefined;
  /** Defined only for settings expanded inline; modal and navigation actions omit it. */
  isExpanded?: boolean | undefined;
  /** ID of the inline panel associated with an expandable row. */
  panelId?: string | undefined;
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
  panelId,
  onAction,
  disabled = false,
}) => {
  const { tr } = useAdminLocale();
  const descriptionId = React.useId();
  const disclosure = isExpanded !== undefined && onAction !== undefined;

  const identity = (
    <>
      {icon && (
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground"
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 space-y-1 text-start">
        <span className="block text-sm font-semibold tracking-tight text-foreground">
          {tr(title)}
        </span>
        {description && (
          <span id={descriptionId} className="block max-w-[72ch] text-sm font-normal leading-relaxed text-muted-foreground">
            {tr(description)}
          </span>
        )}
      </span>
    </>
  );

  if (disclosure) {
    return (
      <h3 className="m-0 font-normal">
        <button
          type="button"
          onClick={onAction}
          disabled={disabled}
          aria-label={tr(title)}
          aria-describedby={description ? descriptionId : undefined}
          aria-expanded={isExpanded}
          aria-controls={panelId}
          className="group flex min-h-20 w-full cursor-pointer items-center gap-3 px-4 py-4 text-start transition-colors hover:bg-muted/25 focus-visible:relative focus-visible:z-10 focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-50 sm:px-5"
        >
          {identity}
          <ChevronDown
            aria-hidden="true"
            className={`size-4 shrink-0 text-muted-foreground motion-safe:transition-transform group-hover:text-foreground ${isExpanded ? "rotate-180" : ""}`}
          />
        </button>
      </h3>
    );
  }

  return (
    <div className="flex min-w-0 flex-col justify-between gap-4 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
      <div className="flex min-w-0 max-w-2xl items-start gap-3">
        {icon && (
          <span aria-hidden="true" className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground">
            {icon}
          </span>
        )}
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">{tr(title)}</h3>
          {description && <p className="text-sm leading-relaxed text-muted-foreground">{tr(description)}</p>}
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
            className="min-h-11 shrink-0 px-4 text-sm"
          >
            {tr(actionLabel)}
          </Button>
        </div>
      )}
    </div>
  );
};
