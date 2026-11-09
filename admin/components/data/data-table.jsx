"use client";
import * as React from "react";
import { ChevronRight, ArrowUpDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Dense grid-based table (no <table>, so columns can hold rich cells).
 * columns: [{ key, header, width: "minmax(10rem,1.4fr)" | "5.625rem", align?: "right", mono?, sortable?, cell?: (row) => node }]
 * rows, getRowId, onRowClick, selectedId, expandable: (row) => node, minWidth, loading, empty
 */
export function DataTable({ columns, rows, getRowId = (r, i) => r.id ?? i, onRowClick, selectedId, expandable, minWidth = 0, rowHeight = 40, loading, empty, sort, onSortChange, className }) {
  const [open, setOpen] = React.useState(null);
  const tpl = (expandable ? "1.75rem " : "") + columns.map((c) => c.width ?? "minmax(0,1fr)").join(" ");
  const head = "grid items-center gap-3 border-t border-border bg-muted px-4 text-xs font-medium text-muted-foreground";
  return (
    <div className={cn("overflow-x-auto", className)}>
      <div style={{ minWidth }} role="table">
        <div role="row" className={head} style={{ gridTemplateColumns: tpl, height: 32 }}>
          {expandable && <span />}
          {columns.map((c) => (
            <span key={c.key} role="columnheader" className={cn("truncate", c.align === "right" && "text-right")}>
              {c.sortable ? (
                <button onClick={() => onSortChange?.({ key: c.key, dir: sort?.key === c.key && sort.dir === "desc" ? "asc" : "desc" })} className={cn("inline-flex items-center gap-1 hover:text-foreground", sort?.key === c.key && "text-foreground")}>
                  {c.header}<ArrowUpDown className="size-3" />
                </button>
              ) : c.header}
            </span>
          ))}
        </div>
        {loading && Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="grid items-center gap-3 border-t border-border px-4" style={{ gridTemplateColumns: tpl, height: rowHeight }}>
            {expandable && <span />}{columns.map((c) => <Skeleton key={c.key} className="h-3 w-3/4" />)}
          </div>
        ))}
        {!loading && rows.length === 0 && empty}
        {!loading && rows.map((r, i) => {
          const id = getRowId(r, i), isOpen = open === id;
          return (
            <div key={id} role="rowgroup">
              <div role="row" onClick={onRowClick ? () => onRowClick(r) : expandable ? () => setOpen(isOpen ? null : id) : undefined}
                className={cn("grid items-center gap-3 border-t border-border px-4 text-[0.8125rem] tabular-nums", (onRowClick || expandable) && "cursor-pointer hover:bg-accent", selectedId === id && "bg-primary-soft hover:bg-primary-soft", isOpen && "bg-muted")}
                style={{ gridTemplateColumns: tpl, minHeight: rowHeight }}>
                {expandable && <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", isOpen && "rotate-90")} />}
                {columns.map((c) => (
                  <span key={c.key} role="cell" className={cn("min-w-0 truncate", c.align === "right" && "text-right", c.mono && "font-mono text-xs")}>
                    {c.cell ? c.cell(r) : r[c.key]}
                  </span>
                ))}
              </div>
              {expandable && isOpen && <div className="border-t border-border bg-muted px-4 py-3 pl-12">{expandable(r)}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Code/JSON block used in expandable rows and webhook/job payloads. */
export function CodeBlock({ children, className }) {
  return <pre className={cn("m-0 whitespace-pre-wrap font-mono text-xs leading-relaxed", className)}>{children}</pre>;
}
