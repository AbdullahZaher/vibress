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
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-border bg-background/95 backdrop-blur-md px-4 sm:px-6 lg:px-8 shadow-2xs">
      {/* Brand Identity / Navigation */}
      <div className="flex items-center gap-3 sm:gap-4">
        {showBack && (
          <button
            type="button"
            onClick={() => navigate(backPath)}
            className="inline-flex size-9 sm:size-10 items-center justify-center rounded-xl border border-border/80 bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer shadow-2xs"
            aria-label={t("common.back") || "Back"}
            title={t("common.back") || "Back"}
          >
            <ArrowLeft className="size-4.5 rtl:rotate-180" />
          </button>
        )}

        <div
          onClick={() => navigate(memberEmail ? "/account" : "/sign-in")}
          className="flex items-center gap-3 cursor-pointer select-none"
        >
          <div className="flex size-8.5 items-center justify-center rounded-xl bg-primary text-primary-foreground font-black text-sm shadow-2xs">
            V
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-sm sm:text-base tracking-tight text-foreground leading-none">
              Vibress
            </span>
            <span className="text-[11px] text-muted-foreground leading-none mt-1">
              {title || t("portal.portal_name") || "Member Portal"}
            </span>
          </div>
        </div>
      </div>

      {/* Controls & Member Identity */}
      <div className="flex items-center gap-2 sm:gap-3">
        <LanguageSwitcher />

        {memberEmail && (
          <div className="flex items-center gap-2.5 ps-2.5 border-s border-border/80">
            <Avatar
              fallback={memberName || memberEmail}
              size="md"
              className="size-8.5 text-xs font-bold border border-border shadow-2xs"
            />
            {onLogout && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onLogout}
                title={t("portal.sign_out")}
                aria-label={t("portal.sign_out")}
                className="size-9 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                <LogOut className="size-4 rtl:rotate-180" />
              </Button>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
