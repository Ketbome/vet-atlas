import { MARK_PATH } from "./mark-path";

// The mark is the lateral silhouette of the atlas's own scanned dog skull
// (scripts/build-brand.ts), bone on an ink plate.
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <rect width="100" height="100" rx="22" className="fill-ink" />
      <path d={MARK_PATH} transform="translate(9 9) scale(0.82)" className="fill-background" />
    </svg>
  );
}

// Bare skull, for use on top of other surfaces (e.g. the home plate).
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path d={MARK_PATH} fill="currentColor" />
    </svg>
  );
}
