import { SourceTag } from "@/components/data/source-tag";

/** Page title + subtitle (+ source tag) + right-side filters, and optional tabs underneath. */
export function PageHeader({ title, subtitle, source, actions, tabs }) {
  return (
    <header className="border-b border-border px-6 pt-[18px]">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-3.5 data-[tabs=true]:pb-0" data-tabs={!!tabs}>
        <div className="flex min-w-0 flex-col gap-[3px]">
          <h1 className="text-xl font-semibold tracking-[-0.015em]">{title}</h1>
          {(subtitle || source) && <div className="flex items-center gap-2 text-[13px] text-muted-foreground">{subtitle}{source && <SourceTag {...source} />}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
      {tabs && <div className="mt-2.5">{tabs}</div>}
    </header>
  );
}

export function PageBody({ children }) {
  return <div className="flex flex-col gap-4 px-6 pb-10 pt-4">{children}</div>;
}
