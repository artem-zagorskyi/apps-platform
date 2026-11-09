import { Badge } from '@/components/ui/badge';

// Change kind → badge tone and label
const KIND = {
  removed: ['destructive', 'removed'],
  'type changed': ['warning', 'type changed'],
  changed: ['warning', 'changed'],
  warning: ['warning', 'warning'],
  deprecated: ['outline', 'deprecated'],
  archived: ['outline', 'archived'],
  added: ['success', 'added'],
};
const ORDER = ['removed', 'type changed', 'warning', 'changed', 'deprecated', 'archived', 'added'];

/** items: [{ kind, target, detail? }]; target is shown in mono. */
export function DiffList({ items, empty = 'No changes compared to the current version.' }) {
  if (!items?.length) {
    return <div className="px-3 py-2.5 text-[13px] text-muted-foreground">{empty}</div>;
  }
  const sorted = [...items].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

  return (
    <ul className="flex flex-col">
      {sorted.map((item, index) => {
        const [tone, label] = KIND[item.kind] ?? ['neutral', item.kind];
        return (
          <li
            key={index}
            className="grid grid-cols-[100px_minmax(0,1fr)] items-baseline gap-3 border-t border-border px-3 py-2 text-[13px] first:border-t-0"
          >
            <span>
              <Badge tone={tone} size="sm">
                {label}
              </Badge>
            </span>
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-xs font-medium">{item.target}</span>
              {item.detail && <span className="text-xs text-muted-foreground">{item.detail}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}