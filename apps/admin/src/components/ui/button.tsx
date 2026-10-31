import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none active:scale-[0.99]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-2xs hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-2xs hover:bg-destructive/90",
        outline:
          "border border-border/80 bg-card text-foreground shadow-2xs hover:bg-muted/60 hover:border-border hover:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-2xs hover:bg-secondary/80",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline p-0 h-auto active:scale-100",
      },
      size: {
        default: "min-h-10 px-4 py-2",
        sm: "min-h-10 rounded-md px-3 text-sm",
        xs: "min-h-8 rounded-md px-2.5 text-xs",
        lg: "min-h-11 rounded-md px-6 text-sm",
        icon: "h-10 w-10 p-0 shrink-0",
        "icon-sm": "h-10 w-10 p-0 shrink-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
