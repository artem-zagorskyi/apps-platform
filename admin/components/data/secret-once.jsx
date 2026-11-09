'use client';

import { useState } from 'react';
import { Check, Copy, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

// A secret shown once, right after it is created. The panel keeps it only in
// this component's state: after a reload it is gone for good.
export function SecretOnce({ title, description, value }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard access (e.g. plain http): the value is selectable by hand
    }
  }

  return (
    <div role="status" className="flex flex-col gap-2.5 rounded-lg border border-warning bg-warning-soft p-3.5">
      <div className="flex items-start gap-2.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="flex flex-col gap-0.5 text-[0.8125rem]">
          <span className="font-semibold">{title}</span>
          <span className="text-muted-foreground text-pretty">{description} It is not shown again.</span>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 select-all break-all rounded-md border border-border bg-card px-2.5 py-2 font-mono text-xs leading-relaxed">
          {value}
        </code>
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}