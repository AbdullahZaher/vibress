import { useCallback, useState } from "react";
import { Dialog } from "../../ui/dialog";
import { Button } from "../../ui/button";
import { useAdminLocale } from "../../../lib/admin-locale";

interface ConfirmationRequest {
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  resolve: (approved: boolean) => void;
}

/** Replaces blocking browser confirms with a focus-managed, localized dialog. */
export function useSettingsConfirmation() {
  const { tr } = useAdminLocale();
  const [pending, setPending] = useState<ConfirmationRequest | null>(null);
  const confirm = useCallback(
    (message: string, options?: { confirmLabel?: string; destructive?: boolean }) =>
      new Promise<boolean>(resolve => setPending({ message, resolve, ...options })),
    [],
  );
  const settle = (approved: boolean) => {
    pending?.resolve(approved);
    setPending(null);
  };

  const confirmationDialog = (
    <Dialog
      isOpen={pending !== null}
      onClose={() => settle(false)}
      title={tr("Confirm settings change")}
      className="settings-confirmation-dialog"
    >
      <p className="text-sm leading-relaxed text-muted-foreground">{pending?.message}</p>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => settle(false)}>
          {tr("Cancel")}
        </Button>
        <Button
          type="button"
          variant={pending?.destructive ? "destructive" : "default"}
          onClick={() => settle(true)}
        >
          {pending?.confirmLabel ?? tr("Continue")}
        </Button>
      </div>
    </Dialog>
  );
  return { confirm, confirmationDialog, isConfirmOpen: pending !== null };
}
