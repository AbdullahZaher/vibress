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

/** The same accessible filter for both publishing resources. On narrow screens use a native select. */
export function EditorialStatusFilter({ label, options, value, onChange }: EditorialStatusFilterProps) {
  return (
    <div className="min-w-0 flex-1 xl:flex-none">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:hidden"
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <div role="group" aria-label={label} className="hidden min-h-11 max-w-full items-center gap-1 overflow-x-auto md:flex">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
              value === option.value ? "bg-muted text-foreground font-semibold" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            }`}
          >{option.label}</button>
        ))}
      </div>
    </div>
  );
}
