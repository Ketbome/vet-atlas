import { useTranslations } from "next-intl";
import type { Media } from "@/lib/content/schema";
import { localeName } from "@/lib/content/load";

export function MediaGallery({ items, locale, emptyText }: { items: Media[]; locale: string; emptyText: string }) {
  const t = useTranslations("media");
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map((m) => (
        <li key={m.id} className="overflow-hidden rounded-md border border-border bg-background">
          <a href={m.url} target="_blank" rel="noreferrer" className="block bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.url} alt={m.caption ? localeName(m.caption, locale) : m.id} loading="lazy" className="aspect-[4/3] w-full object-cover" />
          </a>
          <div className="space-y-1 p-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-medium">
              <span>{t(`type.${m.type}`)}</span>
              {m.stain && <span className="text-muted-foreground">{t("stain", { stain: m.stain })}</span>}
              {m.magnification && <span className="text-muted-foreground">{t("magnification", { value: m.magnification })}</span>}
            </div>
            {m.caption && <p className="text-foreground/85">{localeName(m.caption, locale)}</p>}
            <p className="text-muted-foreground">
              {m.attribution} · {m.license}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
