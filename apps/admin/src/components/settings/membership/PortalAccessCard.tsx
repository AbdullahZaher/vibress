import React, { useState } from "react";
import { SettingsCard } from "../SettingsCard";
import { SettingsCardRow } from "../SettingsCardRow";
import { Input } from "../../ui/input";
import { UserCheck, UserX, Sparkles, Mail } from "lucide-react";
import { Badge } from "../../ui/badge";

interface PortalAccessCardProps {
  signupEnabled: boolean;
  defaultNewsletterOptIn: boolean;
  memberSessionTtlHours: number;
  onChange: (
    key: "signupEnabled" | "defaultNewsletterOptIn" | "memberSessionTtlHours",
    value: unknown,
  ) => void;
  isHighlighted?: boolean | undefined;
}

export const PortalAccessCard: React.FC<PortalAccessCardProps> = ({
  signupEnabled,
  defaultNewsletterOptIn,
  memberSessionTtlHours,
  onChange,
  isHighlighted,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <SettingsCard id="membership-portal" isHighlighted={isHighlighted}>
      <SettingsCardRow
        icon={<UserCheck className="h-4 w-4" />}
        title="Subscription access & portal"
        description="Configure who can sign up, access member-only content, and preview reader portal popups."
        currentValue={
          signupEnabled ? (
            <Badge
              variant="secondary"
              className="text-xs font-mono gap-1 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
            >
              <UserCheck className="h-3 w-3" /> Anyone can sign up
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-xs font-mono gap-1 text-muted-foreground"
            >
              <UserX className="h-3 w-3" /> Signups Closed
            </Badge>
          )
        }
        actionLabel={isExpanded ? "Close" : "Configure"}
        isExpanded={isExpanded}
        onAction={() => setIsExpanded(!isExpanded)}
      />

      {isExpanded && (
        <div className="border-t border-border/40 p-5 bg-muted/15 space-y-5 animate-in slide-in-from-top-2 duration-150">
          {/* Live Portal Popup Mockup (matching Ghost screenshot) */}
          <div className="rounded-xl border border-border/70 overflow-hidden bg-card p-5 max-w-md mx-auto text-center space-y-3 shadow-md">
            <div className="size-9 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
              <Mail className="h-4 w-4" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-foreground">
                Sign up for Vibress
              </h4>
              <p className="text-xs text-muted-foreground">
                Get the latest thoughts and stories delivered right to your
                inbox.
              </p>
            </div>
            <div className="flex gap-2 max-w-xs mx-auto pt-1">
              <Input
                placeholder="jamie@example.com"
                disabled
                className="text-xs h-8.5 bg-muted/30"
              />
              <button
                type="button"
                disabled
                className="bg-primary text-primary-foreground text-xs font-semibold px-3 py-1.5 rounded-md shrink-0 opacity-90 cursor-default"
              >
                Continue
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground pt-1 flex items-center justify-center gap-1">
              <Sparkles className="h-3 w-3 text-primary" /> Live Reader Portal
              Signup Modal Preview
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border/40">
            <div className="flex items-start justify-between gap-4 p-3.5 rounded-lg border border-border/50 bg-card">
              <div>
                <p className="text-xs font-semibold text-foreground">
                  Allow new member signups
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  When enabled, anyone can register and subscribe through your
                  site's member portal.
                </p>
              </div>
              <input
                type="checkbox"
                checked={signupEnabled}
                onChange={(e) => onChange("signupEnabled", e.target.checked)}
                className="size-4 rounded border-border text-primary focus:ring-primary mt-1 cursor-pointer"
              />
            </div>

            <div className="flex items-start justify-between gap-4 p-3.5 rounded-lg border border-border/50 bg-card">
              <div>
                <p className="text-xs font-semibold text-foreground">
                  Default newsletter opt-in
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Automatically subscribe newly registered members to default
                  newsletters.
                </p>
              </div>
              <input
                type="checkbox"
                checked={defaultNewsletterOptIn}
                onChange={(e) =>
                  onChange("defaultNewsletterOptIn", e.target.checked)
                }
                className="size-4 rounded border-border text-primary focus:ring-primary mt-1 cursor-pointer"
              />
            </div>
          </div>

          <div className="space-y-1.5 max-w-xs pt-1">
            <label
              htmlFor="card-member-ttl"
              className="text-xs font-semibold text-foreground"
            >
              Member session duration (Hours)
            </label>
            <Input
              id="card-member-ttl"
              type="number"
              min={1}
              max={8760}
              value={memberSessionTtlHours}
              onChange={(e) =>
                onChange(
                  "memberSessionTtlHours",
                  parseInt(e.target.value, 10) || 720,
                )
              }
              className="bg-card text-xs h-8.5"
            />
            <p className="text-[11px] text-muted-foreground">
              Default is 720 hours (30 days).
            </p>
          </div>
        </div>
      )}
    </SettingsCard>
  );
};
