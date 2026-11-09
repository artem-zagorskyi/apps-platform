// The Renvix mark: R on the accent colour, follows the theme
export function Logo({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className="shrink-0" aria-hidden="true">
      <rect width="20" height="20" rx="5" className="fill-primary" />
      <path
        d="M6.5 15V5h4a3 3 0 0 1 0 6h-4m4 0 3.5 4"
        className="stroke-primary-foreground"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}