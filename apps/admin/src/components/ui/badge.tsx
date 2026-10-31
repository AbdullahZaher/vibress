import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 select-none",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow-2xs hover:bg-primary/90",
        secondary:
          "border-border/80 bg-secondary text-secondary-foreground hover:bg-secondary/80",
        published:
          "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/25",
        draft:
          "bg-slate-500/10 text-slate-800 dark:text-slate-200 border-slate-500/25",
        scheduled:
          "bg-blue-500/10 text-blue-800 dark:text-blue-300 border-blue-500/25",
        success:
          "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/25",
        warning:
          "bg-amber-500/10 text-amber-900 dark:text-amber-300 border-amber-500/25",
        review:
          "bg-amber-500/10 text-amber-900 dark:text-amber-300 border-amber-500/25",
        info:
          "bg-blue-500/10 text-blue-800 dark:text-blue-300 border-blue-500/25",
        destructive:
          "bg-rose-500/10 text-rose-800 dark:text-rose-300 border-rose-500/25",
        outline: "border-border text-foreground bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
