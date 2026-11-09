"use client";
import { Menu as M } from "@base-ui/react/menu";
import { cn } from "@/lib/utils";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export const MenuSeparator = () => <M.Separator className="mx-0.5 my-1 h-px bg-border" />;

export function MenuContent({ className, side = "bottom", align = "start", sideOffset = 4, children }) {
  return (
    <M.Portal>
      <M.Positioner side={side} align={align} sideOffset={sideOffset} className="z-50">
        <M.Popup className={cn("min-w-[12.5rem] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0", className)}>
          {children}
        </M.Popup>
      </M.Positioner>
    </M.Portal>
  );
}
export function MenuItem({ className, destructive, ...p }) {
  return <M.Item className={cn("flex h-8 cursor-default items-center gap-2 rounded-[0.3125rem] px-2 text-[0.8125rem] outline-none select-none data-[highlighted]:bg-accent data-[disabled]:opacity-50 [&_svg]:size-4", destructive && "text-destructive data-[highlighted]:bg-destructive-soft", className)} {...p} />;
}
