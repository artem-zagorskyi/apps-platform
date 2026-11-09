"use client";
import { Field as BaseField } from "@base-ui/react/field";
import { cn } from "@/lib/utils";

/** Label + control + description/error. Pass invalid + error to show the error line. */
export function Field({ label, hint, description, error, invalid, className, children, ...p }) {
  return (
    <BaseField.Root invalid={invalid ?? !!error} className={cn("flex flex-col gap-1.5", className)} {...p}>
      {label && (
        <BaseField.Label className="text-xs font-medium text-foreground">
          {label}{hint && <span className="font-normal text-muted-foreground"> · {hint}</span>}
        </BaseField.Label>
      )}
      {children}
      {error ? (
        <BaseField.Error match className="flex items-center gap-1 text-xs font-medium text-destructive">{error}</BaseField.Error>
      ) : description ? (
        <BaseField.Description className="text-xs text-muted-foreground">{description}</BaseField.Description>
      ) : null}
    </BaseField.Root>
  );
}
