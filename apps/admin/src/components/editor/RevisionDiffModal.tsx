import React, { useState } from "react";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { RotateCcw, Clock } from "lucide-react";

export interface RevisionItem {
  id: string;
  revisionNumber: number;
  title: string;
  content?: Record<string, unknown> | null | undefined;
  createdAt: string;
}

interface RevisionDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  revisions: RevisionItem[];
  currentTitle: string;
  currentContent: Record<string, unknown>;
  onRestore: (revisionId: string) => void;
}

function extractTextFromDocument(doc: Record<string, unknown> | null | undefined): string {
  if (!doc) return "";
  try {
    const root = (doc["root"] as Record<string, unknown>) || doc;
    const children = Array.isArray(root["children"]) ? root["children"] : [];
    return children
      .map((child: Record<string, unknown>) => {
        if (Array.isArray(child["children"])) {
          return child["children"]
            .map((c: Record<string, unknown>) => (typeof c["text"] === "string" ? c["text"] : ""))
            .join("");
        }
        return typeof child["text"] === "string" ? child["text"] : "";
      })
      .filter(Boolean)
      .join("\n\n");
  } catch {
    return JSON.stringify(doc, null, 2);
  }
}

export const RevisionDiffModal: React.FC<RevisionDiffModalProps> = ({
  isOpen,
  onClose,
  revisions,
  currentTitle,
  currentContent,
  onRestore,
}) => {
  const [selectedRevId, setSelectedRevId] = useState<string>(
    revisions[0]?.id || "",
  );

  const selectedRev = revisions.find((r) => r.id === selectedRevId) || revisions[0];
  const currentText = extractTextFromDocument(currentContent);
  const revText = extractTextFromDocument(selectedRev?.content);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Revision History & Visual Diff"
      description="Compare previous versions against current working draft and selectively rollback."
      className="max-w-4xl"
    >
      <div className="flex flex-col gap-4">
        {/* Revision Selector Bar */}
        <div className="flex items-center gap-2 py-1 overflow-x-auto border-b">
          {revisions.map((rev) => (
            <button
              key={rev.id}
              type="button"
              onClick={() => setSelectedRevId(rev.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors shrink-0 flex items-center gap-1.5 ${
                selectedRev?.id === rev.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/40 text-muted-foreground hover:bg-muted"
              }`}
            >
              <Clock className="h-3 w-3" />
              v#{rev.revisionNumber} ({new Date(rev.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
            </button>
          ))}
        </div>

        {/* Side by Side Diff Viewer */}
        <div className="grid grid-cols-2 gap-4 min-h-[260px] max-h-[50vh] overflow-y-auto">
          {/* Selected Historical Revision */}
          <div className="flex flex-col rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center justify-between border-b pb-2 mb-2">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                Historical (Version #{selectedRev?.revisionNumber ?? 1})
              </span>
              <span className="text-[11px] text-muted-foreground">
                {selectedRev ? new Date(selectedRev.createdAt).toLocaleTimeString() : ""}
              </span>
            </div>
            <h4 className="text-xs font-semibold mb-2">
              {selectedRev?.title || "(Untitled)"}
            </h4>
            <div className="flex-1 text-[11px] text-muted-foreground font-mono whitespace-pre-wrap leading-relaxed overflow-y-auto">
              {revText || "(Empty Document)"}
            </div>
          </div>

          {/* Current Working Draft */}
          <div className="flex flex-col rounded-lg border bg-background p-3 shadow-sm">
            <div className="flex items-center justify-between border-b pb-2 mb-2">
              <span className="text-[11px] font-bold text-primary uppercase tracking-wider">
                Current Working Draft
              </span>
              <span className="text-[11px] text-muted-foreground">Latest</span>
            </div>
            <h4 className="text-xs font-semibold mb-2">
              {currentTitle || "(Untitled)"}
            </h4>
            <div className="flex-1 text-[11px] text-foreground font-mono whitespace-pre-wrap leading-relaxed overflow-y-auto">
              {currentText || "(Empty Document)"}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t pt-3">
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
            Close
          </Button>
          {selectedRev && (
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                onRestore(selectedRev.id);
                onClose();
              }}
              className="gap-1.5 text-xs font-semibold"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restore Version #{selectedRev.revisionNumber}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
};
