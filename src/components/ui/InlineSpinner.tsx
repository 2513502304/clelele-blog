/** A local SVG avoids waiting for an icon request to indicate an already pending request. */
export function InlineSpinner({ label, className = '' }: { label?: string; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center ${className}`}>
      <svg viewBox="0 0 20 20" fill="none" className="size-3.5 motion-safe:animate-spin" aria-hidden="true">
        <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="2" opacity="0.2" />
        <path d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}
