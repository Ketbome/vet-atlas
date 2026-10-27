import type { Reference } from "@/lib/content/schema";

export function References({ items, title, emptyText }: { items: Reference[]; title: string; emptyText: string }) {
  return (
    <section className="mt-8 border-t border-border pt-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ol className="mt-2 max-w-[68ch] list-decimal space-y-1 pl-5 text-sm text-foreground/85">
          {items.map((r, i) => (
            <li key={i}>
              {r.url ? (
                <a href={r.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-primary">
                  {r.title}
                </a>
              ) : (
                r.title
              )}
              {r.year ? ` (${r.year})` : ""}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
