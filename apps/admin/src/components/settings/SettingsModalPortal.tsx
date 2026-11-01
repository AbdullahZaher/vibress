import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useAdminLocale } from "../../lib/admin-locale";

interface SettingsModalPortalProps {
  isOpen: boolean;
  label?: string;
  onClose?: (() => void) | undefined;
  children: React.ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const SettingsModalPortal: React.FC<SettingsModalPortalProps> = ({
  isOpen,
  label = "Settings dialog",
  onClose,
  children,
}) => {
  const { tr } = useAdminLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!isOpen || !rootRef.current) return;
    const root = rootRef.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Modal content remains reachable; the underlying app cannot be focused.
    const background = Array.from(document.body.children)
      .filter((element) => element !== root)
      .map((element) => ({ element, wasInert: element.hasAttribute("inert") }));
    for (const { element } of background) element.setAttribute("inert", "");

    const scope = () => {
      const nested = root.querySelectorAll<HTMLElement>('[role="dialog"]');
      return nested.item(nested.length - 1) ?? root;
    };
    const controls = (container: HTMLElement) =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((item) => !item.hidden && !item.closest('[aria-hidden="true"]'));
    const initialScope = scope();
    (controls(initialScope)[0] ?? initialScope).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (onCloseRef.current) {
          event.preventDefault();
          event.stopPropagation();
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const activeScope = scope();
      const tabbable = controls(activeScope);
      const first = tabbable[0];
      const last = tabbable[tabbable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        activeScope.focus();
        return;
      }
      if (!activeScope.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      for (const { element, wasInert } of background) {
        if (!wasInert) element.removeAttribute("inert");
      }
      document.body.style.overflow = originalOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [isOpen]);

  if (!isOpen || typeof document === "undefined") return null;
  return createPortal(
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label={tr(label)}
      className="fixed inset-0 z-50" tabIndex={-1}>
      {children}
    </div>,
    document.body,
  );
};
