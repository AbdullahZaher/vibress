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
import { Badge } from "../../ui/badge";
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
      setStatusMessage({
        success: true,
        text: `Export job queued (Job ID: ${res.job.id}). The archive is being prepared.`,
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
      setStatusMessage({
        success: true,
        text: `Import job created (Job ID: ${res.job.id}). Content is being processed in the background.`,
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
          title="Import / export content"
          description="Back up your entire publication content or migrate from Ghost, WordPress, or Substack."
          currentValue={
            <Badge variant="outline" className="text-xs font-mono">
              Universal Importer Ready
            </Badge>
          }
          actionLabel="Open tools"
          onAction={() => {
            setIsModalOpen(true);
            setStatusMessage(null);
          }}
        />
      </SettingsCard>

      {/* Import & Export Modal */}
      <SettingsModalPortal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      >
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-xl bg-card border border-border/80 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-5 border-b border-border/60 bg-muted/20">
              <div className="flex items-center gap-2">
                <FileJson className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">
                  Import & Export Content
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
                      Export all content
                    </h4>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Generate a complete JSON archive of all posts, pages,
                      tags, and authors.
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
                      {exporting ? "Exporting..." : "Download Export"}
                    </span>
                  </Button>
                </div>

                <div className="p-4 rounded-xl border border-border/60 bg-muted/10 space-y-2.5 flex flex-col justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-foreground">
                      Import content
                    </h4>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Upload an exported JSON archive from Vibress, Ghost, or
                      Substack.
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
                      {importing ? "Validating..." : "Universal Import"}
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
