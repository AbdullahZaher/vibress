import React, { useEffect, useRef } from "react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  Save,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import { useUnsavedChanges } from "./hooks/useUnsavedChanges";
import { useSettingsConfirmation } from "./hooks/useSettingsConfirmation";
import { useAdminLocale } from "../../lib/admin-locale";

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
  const { tr } = useAdminLocale();
  const { confirm, confirmationDialog } = useSettingsConfirmation();
  const navigationPromptOpen = useRef(false);
  const confirmDiscard = async () => {
    if (!saving && await confirm(tr("Discard all unsaved settings changes?"), {
      destructive: true,
      confirmLabel: tr("Discard changes"),
    })) onDiscard();
  };
  const shortcut = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘S" : "Ctrl+S";
  // Guard window navigation / tab close
  useUnsavedChanges(isDirty);

  // Guard in-app sidebar navigation and browser back/forward, not only tab close.
  useEffect(() => {
    if (!isDirty) return;
    const handleNavigation = (event: Event) => {
      const request = event as CustomEvent<{ path: string }>;
      const path = request.detail?.path;
      if (!path || navigationPromptOpen.current) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      navigationPromptOpen.current = true;
      void confirm(tr("Leave settings without saving changes?"), {
        destructive: true,
        confirmLabel: tr("Leave settings"),
      }).then(approved => {
        if (approved) {
          window.dispatchEvent(new CustomEvent("vibress:confirmed-settings-navigation", {
            detail: { path },
          }));
        }
      }).finally(() => { navigationPromptOpen.current = false; });
    };
    window.addEventListener("vibress:before-settings-navigation", handleNavigation);
    return () => window.removeEventListener("vibress:before-settings-navigation", handleNavigation);
  }, [isDirty, confirm, tr]);

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
          className="fixed top-5 end-5 z-50 flex items-center gap-2 p-3.5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 rounded-xl text-xs font-semibold shadow-xl backdrop-blur-md animate-in slide-in-from-top-2 duration-200"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{tr(successMsg)}</span>
        </div>
      )}
      {errorMsg && (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed top-5 end-5 z-50 flex items-center gap-2 p-3.5 bg-destructive/15 border border-destructive/30 text-destructive rounded-xl text-xs font-semibold shadow-xl backdrop-blur-md animate-in slide-in-from-top-2 duration-200"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{tr(errorMsg)}</span>
        </div>
      )}

      {/* Floating Save Action Bar */}
      {isDirty && (
        <div className="fixed bottom-4 sm:bottom-6 inset-x-0 z-40 flex justify-center px-4 pointer-events-none animate-in slide-in-from-bottom-5 duration-200">
          <div role="region" aria-label={tr("Unsaved changes")}
            className="pointer-events-auto flex flex-col min-[420px]:flex-row items-stretch min-[420px]:items-center gap-3 px-4 py-3 rounded-2xl bg-card border border-border shadow-xl text-foreground max-w-lg w-full justify-between">
            <div className="flex min-w-0 items-center gap-2.5">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-amber-500" />
              <span className="text-xs font-medium">{tr("Unsaved changes")}</span>
              {dirtyCount > 0 && (
                <Badge
                  variant="secondary"
                  className="text-xs font-medium px-2 py-0.5 bg-muted"
                >
                  {dirtyCount} {dirtyCount === 1 ? tr("field") : tr("fields")}
                </Badge>
              )}
            </div>

            <div className="grid w-full grid-cols-2 gap-2 min-[420px]:w-auto">
              <Button
                variant="outline"
                size="default"
                onClick={() => void confirmDiscard()}
                disabled={saving}
                className="w-full min-w-0 gap-2"
              >
                <RotateCcw className="size-4 shrink-0" aria-hidden="true" />
                {tr("Discard")}
              </Button>
              <Button
                size="default"
                onClick={onSave}
                loading={saving}
                loadingLabel={tr("Saving...")}
                className="w-full min-w-0 gap-2"
              >
                <Save className="size-4 shrink-0" aria-hidden="true" />
                {tr("Save changes")} <kbd className="text-xs opacity-75" dir="ltr">{shortcut}</kbd>
              </Button>
            </div>
          </div>
        </div>
      )}
      {confirmationDialog}
    </>
  );
};
