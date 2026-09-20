import * as React from "react";
import { cn } from "../utils";

export interface PopoverProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  align?: "start" | "center" | "end";
}

export function Popover({
  trigger,
  children,
  isOpen: controlledOpen,
  onOpenChange,
  className,
  align = "end",
}: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;
  const popoverRef = React.useRef<HTMLDivElement>(null);

  const setIsOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, setIsOpen]);

  const alignClasses = {
    start: "start-0",
    center: "left-1/2 -translate-x-1/2",
    end: "end-0",
  };

  return (
    <div className="relative inline-block" ref={popoverRef}>
      <div onClick={() => setIsOpen(!isOpen)} className="cursor-pointer">
        {trigger}
      </div>

      {isOpen && (
        <div
          className={cn(
            "absolute top-full mt-2 z-50 min-w-[200px] rounded-xl border border-border/80 bg-card p-3 text-card-foreground shadow-2xl animate-in fade-in-0 zoom-in-95 duration-150",
            alignClasses[align],
            className,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
