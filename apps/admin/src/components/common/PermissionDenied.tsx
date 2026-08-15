import React from "react";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { Button } from "../ui/button";

interface PermissionDeniedProps {
  requiredPermission?: string;
  onNavigate?: (path: string) => void;
}

export const PermissionDenied: React.FC<PermissionDeniedProps> = ({
  requiredPermission,
  onNavigate,
}) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center bg-card rounded-xl border border-border shadow-sm">
      <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center mb-4">
        <ShieldAlert className="w-6 h-6" />
      </div>
      <h2 className="text-lg font-bold text-foreground mb-2">
        Access Restricted
      </h2>
      <p className="text-sm text-muted-foreground max-w-md mb-6">
        {requiredPermission
          ? `You do not have the required permission (${requiredPermission}) to view this section.`
          : "You do not have sufficient permissions to access this administrative area."}
      </p>
      {onNavigate && (
        <Button
          onClick={() => onNavigate("/admin")}
          variant="outline"
          className="gap-2"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </Button>
      )}
    </div>
  );
};
