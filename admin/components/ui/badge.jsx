import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1.5 whitespace-nowrap rounded-[0.3125rem] font-medium", {
  variants: {
    tone: {
      neutral: "bg-muted text-muted-foreground",
      outline: "border border-border text-muted-foreground",
      primary: "bg-primary-soft text-primary-soft-foreground",
      success: "bg-success-soft text-success",
      warning: "bg-warning-soft text-warning",
      destructive: "bg-destructive-soft text-destructive",
      solidDestructive: "bg-destructive text-destructive-foreground",
    },
    size: { default: "h-[1.375rem] px-2 text-xs", sm: "h-5 px-1.5 text-[0.6875rem]" },
  },
  defaultVariants: { tone: "neutral", size: "default" },
});

export function Badge({ tone, size, dot = false, className, children, ...props }) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
