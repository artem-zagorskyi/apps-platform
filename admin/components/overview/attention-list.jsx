import Link from 'next/link';
import { Check, ChevronRight, CircleAlert, TriangleAlert } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { appColor } from '@/lib/app-look';
import { num } from '@/lib/overview-format';
import { SETTINGS_TABS } from '@/lib/nav';
import { cn } from '@/lib/utils';

const TAB_LABEL = Object.fromEntries(SETTINGS_TABS.map(({ tab, label }) => [tab, label]));
const settings = (slug, tab) => `/apps/${encodeURIComponent(slug)}/settings/${tab}`;

// Text, detail and link of one item; kinds come from the overview API
function describe(item, slug) {
  switch (item.kind) {
    case 'setting_error':
      return { text: TAB_LABEL[item.tab] ?? item.tab, meta: item.hint, href: settings(slug, item.tab) };
    case 'setup_incomplete':
      return {
        text: 'Setup not finished',
        meta: item.tabs.map((tab) => TAB_LABEL[tab] ?? tab).join(', '),
        href: settings(slug, 'general'),
      };
    case 'invalid_events':
      return {
        text: `${num(item.count)} events failed plan validation`,
        meta: item.event ? `mostly ${item.event}` : null,
        mono: true,
        href: settings(slug, 'events'),
      };
    case 'refused_events':
      return {
        text: `${num(item.count)} analytics events sent without consent`,
        meta: item.appVersion ? `app ${item.appVersion} · a bug in the app` : 'a bug in the app',
        href: settings(slug, 'events'),
      };
    case 'grace_period':
      return {
        text: `${num(item.count)} subscription${item.count === 1 ? '' : 's'} in grace period`,
        meta: item.product,
        href: settings(slug, 'subscriptions'),
      };
    default:
      return { text: item.kind, meta: null, href: settings(slug, 'general') };
  }
}

/** apps: [{ slug, name, status, attention: [...] }] */
export function AttentionList({ apps, showApp }) {
  const items = apps.flatMap((app) => app.attention.map((item) => ({ app, item })));
  items.sort((a, b) => (a.item.severity === b.item.severity ? 0 : a.item.severity === 'critical' ? -1 : 1));

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            Needs attention
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
              {items.length}
            </span>
          </span>
        }
        actions={<span className="text-xs text-muted-foreground">Now</span>}
      />
      {items.length === 0 ? (
        <div className="flex items-center gap-2.5 border-t border-border px-4 py-4 text-[0.8125rem] text-muted-foreground">
          <span className="flex size-6 items-center justify-center rounded-md bg-success-soft text-success">
            <Check className="size-3.5" strokeWidth={2.6} />
          </span>
          Nothing needs attention.
        </div>
      ) : (
        items.map(({ app, item }, index) => {
          const { text, meta, href } = describe(item, app.slug);
          const critical = item.severity === 'critical';
          const Icon = critical ? CircleAlert : TriangleAlert;
          return (
            <div
              key={index}
              className="flex min-h-10 items-center gap-2.5 border-t border-border px-4 py-1.5 text-[0.8125rem]"
            >
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-md',
                  critical ? 'bg-destructive-soft text-destructive' : 'bg-warning-soft text-warning',
                )}
              >
                <Icon className="size-3.5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{text}</span>
                {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
              </span>
              {showApp && (
                <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-2 rounded-[0.125rem]" style={{ background: appColor(app) }} />
                  {app.name}
                </span>
              )}
              <Link
                href={href}
                className="inline-flex shrink-0 items-center text-[0.8125rem] font-medium text-primary-soft-foreground hover:underline"
              >
                View
                <ChevronRight className="size-3.5" />
              </Link>
            </div>
          );
        })
      )}
    </Card>
  );
}
