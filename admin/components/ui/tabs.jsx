"use client";
import { Tabs as T } from "@base-ui/react/tabs";
import { cn } from "@/lib/utils";

/** Underline page tabs (header). tabs: [{ value, label, count?, countTone? }] */
export function PageTabs({ tabs, value, onValueChange, children, className }) {
  return (
    <T.Root value={value} onValueChange={onValueChange} className={className}>
      <T.List className="relative -mb-px flex gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((t) => (
          <T.Tab key={t.value} value={t.value}
            className="flex h-[2.375rem] items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-2.5 text-[0.8125rem] font-medium text-muted-foreground outline-none hover:text-foreground data-[selected]:border-primary data-[selected]:font-semibold data-[selected]:text-foreground focus-visible:bg-accent">
            {t.label}
            {t.count ? (
              <span className={cn("rounded-full px-1.5 text-[0.6875rem] font-semibold", t.countTone === "destructive" ? "bg-destructive-soft text-destructive" : "bg-warning-soft text-warning")}>{t.count}</span>
            ) : null}
          </T.Tab>
        ))}
      </T.List>
      {children}
    </T.Root>
  );
}
export const TabPanel = ({ className, ...p }) => <T.Panel className={cn("outline-none", className)} {...p} />;
