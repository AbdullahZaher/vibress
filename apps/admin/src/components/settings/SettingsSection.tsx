import React from 'react';

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
    <section id={id} className="space-y-3 scroll-mt-6">
      {/* Clean Section Header */}
      <div className="flex items-center justify-between pb-1">
        <div>
          <h2 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
            {icon && <span className="text-primary">{icon}</span>}
            {title}
          </h2>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              {description}
            </p>
          )}
        </div>
      </div>

      {/* Grouped Section Card Container */}
      <div className="rounded-xl border border-border/70 bg-card/60 shadow-xs divide-y divide-border/40 overflow-hidden backdrop-blur-xs">
        {children}
      </div>
    </section>
  );
};
