"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { SearchIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { ViewerModel } from "./types";
import { useViewerStore } from "./store";
import { cn } from "@/lib/utils";

type Props = { model: ViewerModel; selected: string | null; onNavigate?: () => void };

export function StructureTree({ model, selected, onNavigate }: Props) {
  const t = useTranslations("structure");
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
        <label className="flex h-8 items-center gap-2 rounded-md border border-input bg-background px-2 text-sm focus-within:ring-3 focus-within:ring-ring/50">
          <SearchIcon className="size-3.5 text-muted-foreground" />
          <input
            id="structure-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("filter")}
            className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>
      <nav className="p-2" aria-label="structures">
        {groups.map(({ region, items }) => (
          <div key={region.id} className="mb-3">
            <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{region.name}</div>
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
                        "flex items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-primary text-primary-foreground"
                          : hovered === s.id
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-muted",
                      )}
                    >
                      <span className="truncate">{s.title}</span>
                      <span className={cn("nav-latin shrink-0 text-[11px]", active ? "text-primary-foreground/75" : "text-muted-foreground")}>{s.nav}</span>
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
