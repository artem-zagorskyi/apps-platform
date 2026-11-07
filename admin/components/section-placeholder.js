// Stand-in for sections that are not built yet
export function SectionPlaceholder({ title, note }) {
  return (
    <div className="grid gap-2">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{note}</p>
    </div>
  );
}