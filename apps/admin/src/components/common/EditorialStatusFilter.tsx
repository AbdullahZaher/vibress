import { ChevronDown } from "lucide-react";

export interface EditorialStatusOption {
  value: string;
  label: string;
}

interface EditorialStatusFilterProps {
  label: string;
  options: readonly EditorialStatusOption[];
  value: string;
  onChange: (value: string) => void;
}

/** Single accessible status selector for Posts and Pages; quick status views remain in the sidebar. */
export function EditorialStatusFilter({ label, options, value, onChange }: EditorialStatusFilterProps) {
  return (
    <div className="relative min-w-0 w-full shrink-0 sm:w-auto">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full appearance-none rounded-lg border border-border bg-card py-2 pe-10 ps-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-w-44"
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
