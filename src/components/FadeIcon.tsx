// A volume ramp: rising for fade in, falling for fade out.
export function FadeIcon({ dir, className = "h-3.5 w-5" }: { dir: "in" | "out"; className?: string }) {
  return (
    <svg viewBox="0 0 20 14" className={className} aria-hidden="true">
      <path d={dir === "in" ? "M1 13 L19 13 L19 1 Z" : "M1 13 L19 13 L1 1 Z"} fill="currentColor" />
    </svg>
  );
}
