import React from 'react';

export interface SettingsPermissionGateProps {
  permission?: string | undefined;
  can?: ((perm: string) => boolean) | undefined;
  children: React.ReactNode;
  fallback?: React.ReactNode | undefined;
}

export const SettingsPermissionGate: React.FC<SettingsPermissionGateProps> = ({
  permission,
  can,
  children,
  fallback = null,
}) => {
  if (!permission || !can) {
    return <>{children}</>;
  }

  const isAllowed = can(permission);

  if (!isAllowed) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};
