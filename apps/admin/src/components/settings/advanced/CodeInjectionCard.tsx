import React, { useState } from "react";
import { SettingsCard } from "../SettingsCard";
import { SettingsCardRow } from "../SettingsCardRow";
import { SettingsModalPortal } from "../SettingsModalPortal";
import { Button } from "../../ui/button";
import { Code2, Terminal, X } from "lucide-react";
import { Badge } from "../../ui/badge";

interface CodeInjectionCardProps {
  headerCode?: string | undefined;
  footerCode?: string | undefined;
  onChange?:
    ((key: "headerCode" | "footerCode", value: string) => void) | undefined;
  isHighlighted?: boolean | undefined;
}

export const CodeInjectionCard: React.FC<CodeInjectionCardProps> = ({
  headerCode = "",
  footerCode = "",
  onChange,
  isHighlighted,
}) => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const hasCode = Boolean(headerCode || footerCode);

  return (
    <>
      <SettingsCard id="advanced-code" isHighlighted={isHighlighted}>
        <SettingsCardRow
          icon={<Code2 className="h-4 w-4" />}
          title="Code injection"
          description="Inject custom CSS styles, meta tags, and JavaScript trackers into the site header or footer."
          currentValue={
            hasCode ? (
              <Badge variant="secondary" className="text-xs font-mono">
                Custom Code Active
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-xs font-mono text-muted-foreground"
              >
                None Injected
              </Badge>
            )
          }
          actionLabel="Edit code"
          onAction={() => setIsDrawerOpen(true)}
        />
      </SettingsCard>

      {/* Code Injection Drawer */}
      <SettingsModalPortal
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      >
        <div className="fixed inset-0 z-50 flex justify-end bg-background/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-2xl bg-card border-l border-border/80 shadow-2xl h-full flex flex-col justify-between animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border/60 bg-muted/20">
              <div className="flex items-center gap-2">
                <Code2 className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">
                  Code Injection Editor
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              <div className="space-y-1.5">
                <label
                  htmlFor="card-code-head"
                  className="text-xs font-semibold text-foreground flex items-center gap-1.5"
                >
                  <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                  Site Header Code (Injects into &lt;head&gt;)
                </label>
                <textarea
                  id="card-code-head"
                  value={headerCode}
                  onChange={(e) => onChange?.("headerCode", e.target.value)}
                  rows={8}
                  className="w-full rounded-lg border border-input bg-muted/30 px-3.5 py-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="<!-- Add custom <style>, <meta>, or <script> tags here -->"
                />
              </div>

              <div className="space-y-1.5 pt-2">
                <label
                  htmlFor="card-code-foot"
                  className="text-xs font-semibold text-foreground flex items-center gap-1.5"
                >
                  <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                  Site Footer Code (Injects before &lt;/body&gt;)
                </label>
                <textarea
                  id="card-code-foot"
                  value={footerCode}
                  onChange={(e) => onChange?.("footerCode", e.target.value)}
                  rows={8}
                  className="w-full rounded-lg border border-input bg-muted/30 px-3.5 py-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="<!-- Add custom tracking scripts or chat widgets here -->"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-border/60 bg-muted/20 flex justify-end">
              <Button
                size="sm"
                onClick={() => setIsDrawerOpen(false)}
                className="text-xs cursor-pointer"
              >
                Done Editing
              </Button>
            </div>
          </div>
        </div>
      </SettingsModalPortal>
    </>
  );
};
