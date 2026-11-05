import { useState } from "react";

export interface StudioDocumentRecoveryProps {
  message: string;
  rawDocument: unknown;
  resourceLabel: string;
}

/** Fail closed for unsupported persisted documents. Never offer an editor
 * instance which might save a truncated/empty version over the original.
 */
export function StudioDocumentRecovery({
  message, rawDocument, resourceLabel,
}: StudioDocumentRecoveryProps) {
  const [exportError, setExportError] = useState<string | null>(null);

  const exportOriginal = () => {
    try {
      const content = typeof rawDocument === "string"
        ? rawDocument : JSON.stringify(rawDocument, null, 2);
      if (typeof content !== "string") throw new Error("No source data available.");
      const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `vibress-${resourceLabel}-recovery.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportError(null);
    } catch {
      setExportError("The original document could not be exported. Contact support without replacing the stored content.");
    }
  };

  return (
    <section role="alert" aria-live="assertive"
      className="p-6 bg-background text-foreground border border-destructive/40 rounded-lg">
      <h2 className="font-semibold">Document recovery required</h2>
      <p>{message}</p>
      <p>This document is not editable in the installed Studio version.
        The stored source is preserved. Saving a replacement is disabled.</p>
      <button type="button" onClick={exportOriginal}
        className="mt-3 rounded border px-3 py-2 focus-visible:outline focus-visible:outline-2">
        Export original document
      </button>
      {exportError && <p role="status">{exportError}</p>}
    </section>
  );
}
