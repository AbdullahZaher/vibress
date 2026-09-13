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
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        published:
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
        draft:
          "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20",
        scheduled:
          "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
        success:
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
        warning:
          "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
        review:
          "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
        info:
          "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
        destructive:
          "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
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
