import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useAdminLocale } from "../../lib/admin-locale";

interface SettingsModalPortalProps {
  isOpen: boolean;
  onClose?: (() => void) | undefined;
  title?: string | undefined;
  /** Themes manages its own nested theme-upload dialog and focus scope. */
  manageFocus?: boolean | undefined;
  children: React.ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const SettingsModalPortal: React.FC<SettingsModalPortalProps> = ({
  isOpen,
  onClose,
  title = "Settings dialog",
  manageFocus = true,
  children,
}) => {
  const { locale, tr } = useAdminLocale();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const getFocusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      .filter(element => element.getClientRects().length > 0 || (
        getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden"
      ));

    if (manageFocus) {
      // Focus the heading container first so a long form does not jump past its title.
      dialogRef.current?.focus();
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current?.();
        return;
      }
      if (!manageFocus || event.key !== "Tab") return;
      const items = getFocusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current?.focus();
      } else if (!dialogRef.current?.contains(document.activeElement) ||
        (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current))) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (manageFocus && previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen, manageFocus]);

  if (!isOpen || typeof document === "undefined") return null;
  const titles: Record<string, string> = {
    "Navigation menus": "قوائم التنقل",
    "Email delivery": "إعدادات البريد الإلكتروني",
    "Developer integrations": "تكاملات المطورين",
    "Code injection": "إضافة الأكواد",
    "Danger zone": "منطقة العمليات الحساسة",
    "Import and export": "الاستيراد والتصدير",
    "Subscription tiers": "خطط الاشتراك",
    "Recommendations": "التوصيات",
    "Themes manager": "إدارة القوالب",
    "Settings dialog": "نافذة الإعدادات",
  };
  const accessibleName = locale === "ar" ? (titles[title] ?? tr(title)) : title;
  return createPortal(
    <div
      ref={dialogRef}
      role={manageFocus ? "dialog" : undefined}
      aria-modal={manageFocus ? true : undefined}
      aria-label={manageFocus ? accessibleName : undefined}
      tabIndex={manageFocus ? -1 : undefined}
      className="fixed inset-0 z-50 outline-none"
    >
      {children}
    </div>,
    document.body,
  );
};
