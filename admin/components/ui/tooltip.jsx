"use client";
import { Tooltip as T } from "@base-ui/react/tooltip";

export const TooltipProvider = T.Provider;

/** <Tooltip content="Definition…"><span>MAU</span></Tooltip> */
export function Tooltip({ content, side = "top", children }) {
  if (!content) return children;
  return (
    <T.Root>
      <T.Trigger render={children} />
      <T.Portal>
        <T.Positioner side={side} sideOffset={6} className="z-50">
          <T.Popup className="max-w-[17.5rem] rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-md text-pretty transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0">{content}</T.Popup>
        </T.Positioner>
      </T.Portal>
    </T.Root>
  );
}
