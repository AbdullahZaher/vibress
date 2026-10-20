import React from "react";

export interface AdminPageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  backAction?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  id?: string;
  titleId?: string;
}

/**
 * Standardized Admin Page Header component.
 * Follows the visual reference from the Posts page header:
 * - Bold title (text-xl sm:text-2xl font-bold tracking-tight text-foreground)
 * - Muted description directly below the title (text-xs text-muted-foreground mt-0.5)
 * - No leading icon next to the page title
 * - Responsive action controls right-aligned on desktop and adapt to mobile
 */
export const AdminPageHeader: React.FC<AdminPageHeaderProps> = ({
  title,
  description,
  breadcrumb,
  backAction,
  actions,
  children,
  className = "",
  id,
  titleId,
}) => {
  return (
    <div
      id={id}
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${className}`}
    >
      <div className={`min-w-0 ${backAction ? "flex items-center gap-3" : ""}`}>
        {backAction}
        <div className="min-w-0">
          {breadcrumb && (
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">
              {breadcrumb}
            </p>
          )}
          <h1
            id={titleId}
            className="text-xl sm:text-2xl font-bold tracking-tight text-foreground"
          >
            {title}
          </h1>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {description}
            </p>
          )}
        </div>
      </div>
      {(actions || children) && (
        <div className="flex items-center gap-2 flex-wrap self-start sm:self-auto shrink-0">
          {actions}
          {children}
        </div>
      )}
    </div>
  );
};
