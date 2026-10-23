"use client";

import { useEffect, useMemo, useState } from "react";
import Fuse from "fuse.js";
import { useTranslations } from "next-intl";
import { BoneIcon, SearchIcon, StethoscopeIcon } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import type { SearchItem } from "@/lib/content/load";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ShortcutKbd } from "./shortcut-kbd";

export const OPEN_SEARCH = "atlas:open-search";

export function SearchCommand({ items }: { items: SearchItem[] }) {
  const t = useTranslations("search");
  const tn = useTranslations("nav");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const fuse = useMemo(
    () =>
      new Fuse(items, {
        keys: [
          { name: "title", weight: 3 },
          { name: "keywords", weight: 2 },
          { name: "subtitle", weight: 1 },
        ],
        threshold: 0.35,
        ignoreLocation: true,
        minMatchCharLength: 2,
      }),
    [items],
  );

  const results = useMemo(() => {
    if (query.trim().length < 2) return items.slice(0, 12);
    return fuse.search(query, { limit: 20 }).map((r) => r.item);
  }, [query, fuse, items]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    const show = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH, show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH, show);
    };
  }, []);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  const structures = results.filter((r) => r.type === "structure");
  const pathologies = results.filter((r) => r.type === "pathology");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-card px-3 text-sm text-muted-foreground shadow-xs transition-colors hover:border-ring/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={tn("search")}
      >
        <SearchIcon className="size-4 shrink-0" />
        <span className="truncate">{tn("searchHint")}</span>
        <span className="ml-auto hidden items-center sm:flex">
          <ShortcutKbd />
        </span>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen} title={tn("search")} description={t("hint")} showCloseButton={false}>
        <Command shouldFilter={false}>
        <CommandInput placeholder={t("placeholder")} value={query} onValueChange={setQuery} />
        <CommandList className="max-h-[60vh]">
          <CommandEmpty>{t("empty", { query })}</CommandEmpty>
          {structures.length > 0 && (
            <CommandGroup heading={t("structures")}>
              {structures.map((r) => (
                <CommandItem key={r.id} value={r.id} onSelect={() => go(r.href)}>
                  <BoneIcon className="text-muted-foreground" aria-hidden="true" />
                  <span className="font-medium">{r.title}</span>
                  <span lang="la" className="nav-latin ml-auto truncate text-xs text-muted-foreground">
                    {r.subtitle}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {pathologies.length > 0 && (
            <CommandGroup heading={t("pathologies")}>
              {pathologies.map((r) => (
                <CommandItem key={r.id} value={r.id} onSelect={() => go(r.href)}>
                  <StethoscopeIcon className="text-eosin" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="font-medium">{r.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{r.subtitle}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
