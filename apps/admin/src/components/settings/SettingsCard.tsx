import React from 'react';

export interface SettingsCardProps {
  id?: string | undefined;
  isHighlighted?: boolean | undefined;
  children: React.ReactNode;
  className?: string | undefined;
}

export const SettingsCard: React.FC<SettingsCardProps> = ({
  id,
  isHighlighted,
  children,
  className = '',
}) => {
  return (
    <div
      id={id}
      className={`transition-colors duration-200 ${
        isHighlighted ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-muted/15'
      } ${className}`}
    >
      {children}
    </div>
  );
};
