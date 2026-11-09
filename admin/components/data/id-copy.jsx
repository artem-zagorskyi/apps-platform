"use client";
import * as React from "react";
import { Copy, Check } from "lucide-react";
import { shortId } from "@/lib/format";

/** Shortened ID with copy-on-click; full value in the title. */
export function IdCopy({ value, length = 8 }) {
  const [ok, setOk] = React.useState(false);
  return (
    <button title={value} onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(value); setOk(true); setTimeout(() => setOk(false), 1200); }}
      className="inline-flex items-center gap-1 rounded px-1 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
      {shortId(value, length)}{ok ? <Check className="size-3 text-success" /> : <Copy className="size-3 opacity-60" />}
    </button>
  );
}
export const Mono = ({ children, className = "" }) => <span className={"font-mono text-xs font-medium " + className}>{children}</span>;
