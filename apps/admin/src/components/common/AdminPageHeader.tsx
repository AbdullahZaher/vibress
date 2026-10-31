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
 * - Readable muted description (text-sm leading-relaxed text-muted-foreground mt-1)
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
            <p className="mb-1 text-xs font-medium text-muted-foreground">
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
            <p className="text-sm leading-relaxed text-muted-foreground mt-1">
              {description}
            </p>
          )}
        </div>
      </div>
      {(actions || children) && (
        <div className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-2 self-start sm:w-auto sm:self-auto">
          {actions}
          {children}
        </div>
      )}
    </div>
  );
};
