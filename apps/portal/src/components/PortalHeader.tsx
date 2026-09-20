import React from "react";
import { LanguageSwitcher, useTranslation } from "../lib/i18n";
import { Avatar, Button } from "@vibress/ui";
import { LogOut, ArrowLeft } from "lucide-react";
import { navigate } from "../router";

export interface PortalHeaderProps {
  memberEmail?: string | null;
  memberName?: string | null;
  onLogout?: () => void;
  showBack?: boolean;
  backPath?: string;
  title?: string;
}

export const PortalHeader: React.FC<PortalHeaderProps> = ({
  memberEmail,
  memberName,
  onLogout,
  showBack,
  backPath = "/account",
  title,
}) => {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-30 flex h-14 w-full items-center justify-between border-b border-border bg-background/90 backdrop-blur-md px-4 sm:px-6 shadow-2xs">
      {/* Brand Identity / Navigation */}
      <div className="flex items-center gap-3">
        {showBack && (
          <button
            type="button"
            onClick={() => navigate(backPath)}
            className="inline-flex size-8 items-center justify-center rounded-lg border border-border/80 bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
            aria-label={t("common.back") || "Back"}
            title={t("common.back") || "Back"}
          >
            <ArrowLeft className="size-4 rtl:rotate-180" />
          </button>
        )}

        <div
          onClick={() => navigate(memberEmail ? "/account" : "/sign-in")}
          className="flex items-center gap-2.5 cursor-pointer select-none"
        >
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground font-black text-xs shadow-2xs">
            V
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-sm tracking-tight text-foreground leading-none">
              Vibress
            </span>
            <span className="text-[10px] text-muted-foreground leading-none mt-0.5">
              {title || t("portal.portal_name") || "Member Portal"}
            </span>
          </div>
        </div>
      </div>

      {/* Controls & Member Identity */}
      <div className="flex items-center gap-2 sm:gap-3">
        <LanguageSwitcher />

        {memberEmail && (
          <div className="flex items-center gap-2 ps-2 border-s border-border/60">
            <Avatar
              fallback={memberName || memberEmail}
              size="sm"
              className="size-7 text-xs border border-border"
            />
            {onLogout && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onLogout}
                title={t("portal.sign_out")}
                aria-label={t("portal.sign_out")}
                className="text-muted-foreground hover:text-destructive"
              >
                <LogOut className="size-3.5 rtl:rotate-180" />
              </Button>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
