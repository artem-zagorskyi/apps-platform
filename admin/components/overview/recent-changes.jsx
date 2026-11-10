import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { AdminAvatar } from '@/components/data/admin-avatar';
import { Card, CardHeader } from '@/components/ui/card';
import { fullTime, relativeTime } from '@/lib/audit-format';
import { actionArea, actionSentence } from '@/lib/audit-sentence';

/** entries: from the audit log, newest first */
export function RecentChanges({ entries }) {
  return (
    <Card>
      <CardHeader
        title="Recent changes"
        actions={
          <Link
            href="/admins/audit-log"
            className="inline-flex items-center text-[0.8125rem] font-medium text-primary-soft-foreground hover:underline"
          >
            Audit log
            <ChevronRight className="size-3.5" />
          </Link>
        }
      />
      {entries.length === 0 && (
        <div className="border-t border-border px-4 py-4 text-[0.8125rem] text-muted-foreground">No changes yet.</div>
      )}
      {entries.map((entry) => {
        const { text, object } = actionSentence(entry);
        return (
          <div
            key={entry.id}
            className="grid min-h-[2.375rem] grid-cols-[5.75rem_1.25rem_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-border px-4 text-[0.8125rem]"
          >
            <span title={fullTime(entry.createdAt)} className="text-xs tabular-nums text-muted-foreground">
              {relativeTime(entry.createdAt)}
            </span>
            <AdminAvatar email={entry.admin?.email} />
            <span className="truncate">
              {text}
              {object && <span className="ml-1 font-mono text-xs">{object}</span>}
            </span>
            <span className="rounded-[0.25rem] border border-border px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground">
              {actionArea(entry.action)}
            </span>
          </div>
        );
      })}
    </Card>
  );
}
