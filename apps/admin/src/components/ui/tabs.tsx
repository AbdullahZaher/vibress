import * as React from "react";
import { cn } from "@/lib/utils";

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
  baseId: string;
}

const TabsContext = React.createContext<TabsContextValue | undefined>(
  undefined,
);

export function Tabs({
  value,
  onValueChange,
  children,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const baseId = React.useId();
  return (
    <TabsContext.Provider value={{ value, onValueChange, baseId }}>
      <div className={cn("w-full", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const list = listRef.current;
    if (!list) return;
    const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'));
    const activeIndex = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (activeIndex === -1) return;

    const rtl = getComputedStyle(list).direction === "rtl";
    let targetIndex: number;
    if (event.key === "ArrowRight") {
      targetIndex = (activeIndex + (rtl ? -1 : 1) + tabs.length) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      targetIndex = (activeIndex + (rtl ? 1 : -1) + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      targetIndex = 0;
    } else if (event.key === "End") {
      targetIndex = tabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    tabs[targetIndex]?.focus();
    tabs[targetIndex]?.click();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
      className={cn(
        "inline-flex min-h-11 items-center justify-start rounded-xl bg-muted/60 p-1 text-muted-foreground border border-border/40 gap-1 overflow-x-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error("TabsTrigger must be used within Tabs");

  const isActive = context.value === value;

  return (
    <button
      type="button"
      role="tab"
      id={`${context.baseId}-tab-${value}`}
      aria-controls={`${context.baseId}-panel-${value}`}
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      onClick={() => context.onValueChange(value)}
      className={cn(
        "inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none",
        isActive
          ? "bg-card text-foreground shadow-2xs font-semibold border border-border/60"
          : "text-muted-foreground hover:text-foreground hover:bg-card/50",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error("TabsContent must be used within Tabs");

  if (context.value !== value) return null;

  return (
    <div
      role="tabpanel"
      id={`${context.baseId}-panel-${value}`}
      aria-labelledby={`${context.baseId}-tab-${value}`}
      tabIndex={0}
      className={cn(
        "mt-4 outline-none focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      {children}
    </div>
  );
}
