import React, { useState, useRef, useEffect } from "react";
import {
  ChevronsUpDown,
  ExternalLink,
  Settings,
  Shield,
  LogOut,
} from "lucide-react";
import { ApiUser } from "../../../lib/api";
import { Avatar } from "../../ui/avatar";

interface UserMenuProps {
  user: ApiUser;
  onLogout: () => void;
  onNavigate?: (path: string) => void;
}

export const UserMenu: React.FC<UserMenuProps> = ({
  user,
  onLogout,
  onNavigate,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  return (
    <div className="relative" ref={menuRef}>
      {/* User Card Trigger */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between p-2 rounded-xl bg-card border border-border hover:border-border/90 hover:bg-muted/30 transition-all cursor-pointer select-none"
        title="Account menu"
      >
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="relative shrink-0">
            <Avatar
              fallback={user.name}
              size="sm"
              className="bg-muted text-foreground border border-border font-bold"
            />
            <span className="absolute bottom-0 right-0 size-2 rounded-full bg-[#3eb083] ring-2 ring-card" />
          </div>
          <div className="flex flex-col overflow-hidden text-left">
            <span className="text-xs font-semibold text-foreground truncate leading-none">
              {user.name}
            </span>
            <span className="text-[10px] text-muted-foreground truncate">
              {user.email}
            </span>
          </div>
        </div>

        <div className="text-muted-foreground hover:text-foreground p-1 transition-colors">
          <ChevronsUpDown className="h-4 w-4" />
        </div>
      </div>

      {/* Popover Dropdown Menu */}
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-full min-w-[240px] rounded-2xl bg-card border border-border shadow-2xl p-2 z-50 text-foreground animate-in fade-in zoom-in-95 duration-150">
          {/* Header Identity */}
          <div className="px-2.5 py-2 border-b border-border/60 mb-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground truncate">
                {user.name}
              </span>
              <span className="text-[10px] font-mono uppercase bg-primary/10 text-primary px-1.5 py-0.5 rounded font-semibold border border-primary/20">
                Staff
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">
              {user.email}
            </p>
          </div>

          {/* Quick Actions */}
          <div className="space-y-0.5 text-xs">
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              onClick={() => setIsOpen(false)}
              className="flex items-center justify-between px-2.5 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <div className="flex items-center gap-2">
                <ExternalLink className="h-3.5 w-3.5" />
                <span>View Live Site</span>
              </div>
            </a>

            {onNavigate && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onNavigate("/admin/settings/general");
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer text-left"
                >
                  <div className="flex items-center gap-2">
                    <Settings className="h-3.5 w-3.5" />
                    <span>General Settings</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onNavigate("/admin/settings/advanced");
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer text-left"
                >
                  <div className="flex items-center gap-2">
                    <Shield className="h-3.5 w-3.5" />
                    <span>Advanced & Platform</span>
                  </div>
                </button>
              </>
            )}
          </div>

          {/* Separator & Logout */}
          <div className="border-t border-border/60 my-1 pt-1">
            <button
              type="button"
              aria-label="Sign out"
              onClick={() => {
                setIsOpen(false);
                onLogout();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 transition-colors cursor-pointer text-xs font-semibold text-left"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
