import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Vibress Button System v2.
 * Sizes: xs=32, sm=40, default=44, lg=48, icon=44, icon-sm=40 CSS px.
 * All spacing and colors come from semantic design tokens.
 */
const buttonVariants = cva(
  "relative inline-flex min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium cursor-pointer select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50 motion-safe:transition-[background-color,color,border-color,box-shadow,transform] motion-safe:duration-150",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-2xs hover:bg-primary/90 motion-safe:active:scale-[0.99]",
        destructive: "bg-destructive text-destructive-foreground shadow-2xs hover:bg-destructive/90 motion-safe:active:scale-[0.99]",
        outline: "border border-border/80 bg-card text-foreground shadow-2xs hover:bg-muted/60 hover:border-border motion-safe:active:scale-[0.99]",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 motion-safe:active:scale-[0.99]",
        subtle: "bg-muted/70 text-foreground hover:bg-muted",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        link: "h-auto p-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-11 px-4 py-2",
        sm: "min-h-10 rounded-md px-3 text-sm",
        xs: "min-h-8 rounded-md px-2.5 text-xs",
        lg: "min-h-12 px-6 text-sm",
        icon: "size-11 p-0 shrink-0",
        "icon-sm": "size-10 p-0 shrink-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Busy state automatically disables the button and preserves its text footprint. */
  loading?: boolean;
  /** Localized accessible name while loading, e.g. "Saving…". */
  loadingLabel?: string;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({
    className, variant, size, type = "button", disabled, loading = false,
    loadingLabel, children, "aria-label": ariaLabel, ...props
  }, ref) => {
    return (
      <button
        {...props}
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        aria-label={loading && loadingLabel ? loadingLabel : ariaLabel}
        className={cn(buttonVariants({ variant, size, className }))}
      >
        {loading ? (
          <>
            <span aria-hidden="true" className="invisible inline-flex items-center gap-2">{children}</span>
            <LoaderCircle aria-hidden="true" className="pointer-events-none absolute size-4 animate-spin motion-reduce:animate-none" />
          </>
        ) : children}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
