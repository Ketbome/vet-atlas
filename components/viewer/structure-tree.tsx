"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { SearchIcon, XIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { ViewerModel } from "./types";
import { useViewerStore } from "./store";
import { cn } from "@/lib/utils";

type Props = { model: ViewerModel; selected: string | null; onNavigate?: () => void };

export function StructureTree({ model, selected, onNavigate }: Props) {
  const t = useTranslations("structure");
  const tv = useTranslations("viewer");
  const setHovered = useViewerStore((s) => s.setHovered);
  const hovered = useViewerStore((s) => s.hovered);
  const [filter, setFilter] = useState("");

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return model.regions
      .map((r) => ({
        region: r,
        items: model.structures.filter(
          (s) => s.region === r.id && (!q || s.title.toLowerCase().includes(q) || s.nav.toLowerCase().includes(q)),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [model, filter]);

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 border-b border-border bg-sidebar p-2">
        <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 lg:h-9">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="sr-only">{t("filter")}</span>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("filter")}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          {filter && (
            <button type="button" onClick={() => setFilter("")} aria-label={t("clearFilter")} className="grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground">
              <XIcon className="size-3.5" />
            </button>
          )}
        </label>
      </div>
      <nav className="p-2" aria-label={tv("layers")}>
        {groups.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">{t("noMatch", { query: filter })}</p>}
        {groups.map(({ region, items }) => (
          <div key={region.id} className="mb-3">
            <div className="plate-label px-2 pb-1 pt-2">{region.name}</div>
            <ul>
              {items.map((s) => {
                const active = s.id === selected;
                return (
                  <li key={s.id}>
                    <Link
                      href={s.href}
                      onClick={onNavigate}
                      onMouseEnter={() => setHovered(s.id)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered(s.id)}
                      onBlur={() => setHovered(null)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "grid grid-cols-[0.625rem_minmax(0,1fr)] items-baseline gap-x-2.5 rounded-[3px] px-2 py-2 text-sm leading-snug outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 lg:py-1.5",
                        active
                          ? "bg-accent font-semibold text-accent-foreground"
                          : hovered === s.id
                            ? "bg-muted"
                            : "hover:bg-muted",
                      )}
                    >
                      {/* Plate key: the colour the structure has on the model. */}
                      <span className="size-2.5 translate-y-px rounded-[2px] border border-ink/15" style={{ background: s.color ?? model.color }} aria-hidden="true" />
                      <span className="block">{s.title}</span>
                      <span lang="la" className="nav-latin col-start-2 block text-xs font-normal text-muted-foreground">
                        {s.nav}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
