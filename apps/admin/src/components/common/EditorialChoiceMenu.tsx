import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "../ui/button";

export interface EditorialChoice {
  value: string;
  label: string;
}

interface EditorialChoiceMenuProps {
  label: string;
  options: readonly EditorialChoice[];
  value: string;
  onChange: (value: string) => void;
  icon?: ReactNode;
  active?: boolean;
  compact?: boolean;
}

/** Disclosure menu for editorial controls: no permanently exposed native select or option list. */
export function EditorialChoiceMenu({
  label, options, value, onChange, icon, active = false, compact = false,
}: EditorialChoiceMenuProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  const openMenu = () => {
    if (open) { setOpen(false); return; }
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(176, Math.min(240, window.innerWidth - 16));
    const height = Math.min(options.length * 44 + 12, 320);
    const rtl = getComputedStyle(trigger.current!).direction === "rtl";
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rtl ? rect.left : rect.right - width));
    const above = window.innerHeight - rect.bottom < Math.min(height, 180) && rect.top > window.innerHeight - rect.bottom;
    const top = above ? Math.max(8, rect.top - Math.min(height, rect.top - 16) - 6) : Math.min(rect.bottom + 6, window.innerHeight - 80);
    setPosition({ top, left, maxHeight: Math.max(64, above ? rect.top - 16 : window.innerHeight - top - 8) });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const items = menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    const activeItem = Array.from(items ?? []).find(item => item.getAttribute("aria-checked") === "true");
    (activeItem ?? items?.[0])?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    };
    const onMove = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onEscape);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onEscape);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(current + step + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (event.key === "Tab") setOpen(false);
  };

  return (
    <div className="inline-flex min-w-0 shrink-0">
      <Button
        ref={trigger}
        variant={active ? "subtle" : "ghost"}
        size="sm"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="menu"
        onClick={openMenu}
        onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); if (!open) openMenu(); } }}
        className="min-h-11 gap-2 px-3"
      >
        {icon}
        <span>{label}</span>
        {!compact && <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />}
      </Button>
      {open && position && createPortal(
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="fixed z-[100] w-60 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
          style={{ top: position.top, left: position.left, width: Math.max(176, Math.min(240, window.innerWidth - 16)), maxHeight: position.maxHeight }}
        >
          {options.map(option => (
            <Button
              key={option.value}
              variant="ghost"
              size="sm"
              role="menuitemradio"
              aria-checked={option.value === value}
              onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus(); }}
              className="min-h-11 w-full justify-between gap-3 px-3 text-start text-foreground hover:bg-muted focus-visible:bg-muted"
            >
              <span className="min-w-0">{option.label}</span>
              {option.value === value && <Check className="size-4 shrink-0" aria-hidden="true" />}
            </Button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
