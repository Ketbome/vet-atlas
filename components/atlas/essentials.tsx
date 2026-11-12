// `**term**` in a key point is drawn as a highlighter stroke.
export function Essentials({ items, title }: { items?: string[]; title: string }) {
  if (!items?.length) return null;
  return (
    <section aria-labelledby="essentials-title" className="mt-7 max-w-[68ch] rounded-md border border-border bg-card px-5 py-4">
      <h2 id="essentials-title" className="font-heading text-xl text-ink">
        {title}
      </h2>
      <ol className="mt-2.5 space-y-2 text-base leading-relaxed">
        {items.map((item, i) => (
          <li key={item} className="flex gap-3">
            <span aria-hidden className="w-3 shrink-0 font-heading italic text-muted-foreground tabular">
              {i + 1}
            </span>
            <span>
              {item.split("**").map((part, j) =>
                j % 2 ? (
                  <mark
                    key={j}
                    className="rounded-[2px] bg-transparent bg-[linear-gradient(transparent_38%,var(--accent)_38%,var(--accent)_92%,transparent_92%)] px-0.5 font-medium text-ink"
                  >
                    {part}
                  </mark>
                ) : (
                  part
                ),
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
