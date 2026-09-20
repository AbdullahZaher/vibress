import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../utils";
import { AlertCircle, CheckCircle2, AlertTriangle, Info } from "lucide-react";

const alertVariants = cva(
  "relative w-full rounded-xl border p-4 text-xs sm:text-sm flex items-start gap-3 transition-colors animate-in fade-in-50 duration-150 text-start",
  {
    variants: {
      variant: {
        default: "bg-card border-border text-foreground",
        destructive:
          "bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400 [&>svg]:text-red-600 dark:[&>svg]:text-red-400",
        success:
          "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400 [&>svg]:text-emerald-600 dark:[&>svg]:text-emerald-400",
        warning:
          "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400",
        info:
          "bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-400 [&>svg]:text-blue-600 dark:[&>svg]:text-blue-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  icon?: React.ReactNode;
  hideIcon?: boolean;
}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = "default", icon, hideIcon = false, children, ...props }, ref) => {
    const defaultIcons = {
      default: <Info className="size-4 shrink-0 mt-0.5" />,
      destructive: <AlertCircle className="size-4 shrink-0 mt-0.5" />,
      success: <CheckCircle2 className="size-4 shrink-0 mt-0.5" />,
      warning: <AlertTriangle className="size-4 shrink-0 mt-0.5" />,
      info: <Info className="size-4 shrink-0 mt-0.5" />,
    };

    const renderedIcon = !hideIcon ? icon || defaultIcons[variant || "default"] : null;
    const role = variant === "destructive" || variant === "warning" ? "alert" : "status";

    return (
      <div
        ref={ref}
        role={role}
        className={cn(alertVariants({ variant }), className)}
        {...props}
      >
        {renderedIcon}
        <div className="flex-1 space-y-1">{children}</div>
      </div>
    );
  },
);
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("font-semibold leading-none tracking-tight text-foreground", className)}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-xs leading-relaxed opacity-90", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
