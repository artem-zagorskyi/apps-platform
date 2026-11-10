// Small line with a soft area under it, as on the design tiles
export function Sparkline({ values, width = 76, height = 26, className }) {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => [
    (index * width) / (values.length - 1),
    2 + (height - 4) * (1 - (value - min) / span),
  ]);
  const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className ?? 'shrink-0 text-primary'}
      aria-hidden="true"
    >
      <path d={`${line}L${width} ${height}L0 ${height}Z`} fill="currentColor" opacity="0.1" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
