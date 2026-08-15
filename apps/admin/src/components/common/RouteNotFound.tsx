import React from "react";
import { FileQuestion, ArrowLeft } from "lucide-react";
import { Button } from "../ui/button";

interface RouteNotFoundProps {
  path?: string;
  onNavigate?: (path: string) => void;
}

export const RouteNotFound: React.FC<RouteNotFoundProps> = ({
  path,
  onNavigate,
}) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center bg-card rounded-xl border border-border shadow-sm">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4 text-muted-foreground">
        <FileQuestion className="w-6 h-6" />
      </div>
      <h2 className="text-lg font-bold text-foreground mb-2">Page Not Found</h2>
      <p className="text-sm text-muted-foreground max-w-md mb-6">
        The route <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{path || window.location.pathname}</code> does not exist in Vibress Admin.
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
