import React, { useEffect } from "react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  Sparkles,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import { useUnsavedChanges } from "./hooks/useUnsavedChanges";

interface SettingsSaveBarProps {
  isDirty: boolean;
  dirtyCount?: number;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  successMsg: string | null;
  errorMsg: string | null;
}

export const SettingsSaveBar: React.FC<SettingsSaveBarProps> = ({
  isDirty,
  dirtyCount = 0,
  saving,
  onSave,
  onDiscard,
  successMsg,
  errorMsg,
}) => {
  // Guard window navigation / tab close
  useUnsavedChanges(isDirty);

  // Global ⌘S / Ctrl+S keyboard shortcut to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (isDirty && !saving) {
          onSave();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDirty, saving, onSave]);

  return (
    <>
      {/* Toast Feedback */}
      {successMsg && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-5 right-5 z-50 flex items-center gap-2 p-3.5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 rounded-xl text-xs font-semibold shadow-xl backdrop-blur-md animate-in slide-in-from-top-2 duration-200"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed top-5 right-5 z-50 flex items-center gap-2 p-3.5 bg-destructive/15 border border-destructive/30 text-destructive rounded-xl text-xs font-semibold shadow-xl backdrop-blur-md animate-in slide-in-from-top-2 duration-200"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Floating Save Action Bar */}
      {isDirty && (
        <div className="fixed bottom-6 inset-x-0 z-40 flex justify-center px-4 pointer-events-none animate-in slide-in-from-bottom-5 duration-200">
          <div className="pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-card/95 border border-primary/30 shadow-2xl backdrop-blur-md text-foreground max-w-lg w-full justify-between">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
              </span>
              <span className="text-xs font-medium">Unsaved changes</span>
              {dirtyCount > 0 && (
                <Badge
                  variant="secondary"
                  className="text-[10px] font-mono px-1.5 py-0 h-4.5 bg-muted"
                >
                  {dirtyCount} {dirtyCount === 1 ? "field" : "fields"}
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onDiscard}
                disabled={saving}
                className="h-8 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Discard
              </Button>
              <Button
                size="sm"
                onClick={onSave}
                disabled={saving}
                className="h-8 text-xs gap-1.5 cursor-pointer shadow-sm"
              >
                {saving ? (
                  <RefreshCw className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {saving ? "Saving..." : "Save (⌘S)"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
