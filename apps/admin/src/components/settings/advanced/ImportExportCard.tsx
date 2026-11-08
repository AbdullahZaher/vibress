import React, { useState, useRef } from "react";
import { SettingsCard } from "../SettingsCard";
import { SettingsCardRow } from "../SettingsCardRow";
import { SettingsModalPortal } from "../SettingsModalPortal";
import { Button } from "../../ui/button";
import {
  Download,
  Upload,
  FileJson,
  X,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import { useAdminLocale } from "../../../lib/admin-locale";
import {
  createExportApi,
  createImportApi,
  validateImportApi,
} from "../../../lib/api/operations";

interface ImportExportCardProps {
  isHighlighted?: boolean | undefined;
}

export const ImportExportCard: React.FC<ImportExportCardProps> = ({
  isHighlighted,
}) => {
  const { tr } = useAdminLocale();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    success: boolean;
    text: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setExporting(true);
    setStatusMessage(null);
    try {
      const res = await createExportApi();
      const failed = res.job.status === "failed";
      setStatusMessage({
        success: !failed,
        text: `${tr(failed ? "Export failed" : "Export job created")} (${tr("Job ID")}: ${res.job.id}).`,
      });
    } catch (err: unknown) {
      setStatusMessage({
        success: false,
        text: err instanceof Error ? err.message : "Failed to queue export",
      });
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setStatusMessage(null);
    try {
      const text = await file.text();
      let envelope: unknown;
      try {
        envelope = JSON.parse(text);
      } catch {
        throw new Error("Selected file is not valid JSON");
      }

      const val = await validateImportApi(envelope);
      if (!val.valid) {
        throw new Error("Import envelope validation failed");
      }

      const res = await createImportApi(envelope);
      const failed = res.job.status === "failed";
      setStatusMessage({
        success: !failed,
        text: `${tr(failed ? "Import failed" : "Import job created")} (${tr("Job ID")}: ${res.job.id}).`,
      });
    } catch (err: unknown) {
      setStatusMessage({
        success: false,
        text: err instanceof Error ? err.message : "Failed to import file",
      });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <>
      <SettingsCard id="advanced-import-export" isHighlighted={isHighlighted}>
        <SettingsCardRow
          icon={<FileJson className="h-4 w-4" />}
          title="Import and export settings and redirects"
          description="Transfer supported publication settings and redirects using Vibress JSON."
          actionLabel="Open tools"
          onAction={() => {
            setIsModalOpen(true);
            setStatusMessage(null);
          }}
        />
      </SettingsCard>

      {/* Import & Export Modal */}
      <SettingsModalPortal
        title="Import and export"
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      >
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-xl bg-card border border-border/80 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-5 border-b border-border/60 bg-muted/20">
              <div className="flex items-center gap-2">
                <FileJson className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">
                  {tr("Import and export settings and redirects")}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-border/60 bg-muted/10 space-y-2.5 flex flex-col justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-foreground">
                      {tr("Export settings and redirects")}
                    </h4>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {tr("Create a Vibress JSON export of publication settings and redirects. Secrets are excluded.")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={exporting}
                    onClick={handleExport}
                    className="text-xs h-8 gap-1.5 cursor-pointer bg-card"
                  >
                    {exporting ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {tr(exporting ? "Processing..." : "Create export")}
                    </span>
                  </Button>
                </div>

                <div className="p-4 rounded-xl border border-border/60 bg-muted/10 space-y-2.5 flex flex-col justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-foreground">
                      {tr("Import settings and redirects")}
                    </h4>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {tr("Choose a Vibress version 1 JSON file. Only supported settings and redirects are imported.")}
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={importing}
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs h-8 gap-1.5 cursor-pointer bg-card"
                  >
                    {importing ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {tr(importing ? "Processing..." : "Choose JSON file")}
                    </span>
                  </Button>
                </div>
              </div>

              {statusMessage && (
                <div
                  className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${
                    statusMessage.success
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                      : "border-destructive/30 bg-destructive/10 text-destructive"
                  } animate-in fade-in`}
                >
                  {statusMessage.success && (
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                  )}
                  <span>{statusMessage.text}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </SettingsModalPortal>
    </>
  );
};
