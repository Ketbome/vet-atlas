export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" fill="none">
      <rect x="1" y="1" width="30" height="30" rx="7" className="fill-primary" />
      <path
        d="M9 10.5a2.5 2.5 0 0 1 5 0v1.2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-1.2a2.5 2.5 0 0 1 5 0c0 1.4-.9 2.4-2 2.8v5.4c1.1.4 2 1.4 2 2.8a2.5 2.5 0 0 1-5 0v-1.2a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v1.2a2.5 2.5 0 0 1-5 0c0-1.4.9-2.4 2-2.8v-5.4c-1.1-.4-2-1.4-2-2.8Z"
        className="fill-primary-foreground"
      />
    </svg>
  );
}
