import React from "react";

interface SettingsSectionProps {
  id: string;
  title: string;
  description?: string | undefined;
  icon?: React.ReactNode | undefined;
  children: React.ReactNode;
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({
  id,
  title,
  description,
  icon,
  children,
}) => {
  return (
    <section id={id} className="scroll-mt-24 space-y-4">
      {/* Clean Section Header */}
      <div className="flex min-w-0 items-start justify-between pb-1">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
            {icon && <span className="text-muted-foreground">{icon}</span>}
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>

      {/* Grouped Section Card Container */}
      <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card">
        {children}
      </div>
    </section>
  );
};
