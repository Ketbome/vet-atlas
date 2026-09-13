"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import type { SearchItem } from "@/lib/content/load";
import { SearchCommand } from "./search-command";
import { LocaleSwitch } from "./locale-switch";
import { Logo } from "./logo";
import { cn } from "@/lib/utils";

type Props = {
  species: { id: string; name: string; firstSystem: string }[];
  searchIndex: SearchItem[];
};

export function SiteHeader({ species, searchIndex }: Props) {
  const t = useTranslations("site");
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-full max-w-[1600px] items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={t("name")}>
          <Logo className="size-7" />
          <span className="font-heading text-[17px] font-semibold tracking-tight">{t("name")}</span>
        </Link>

        <nav className="ml-2 hidden items-center gap-1 md:flex" aria-label="species">
          {species.map((s) => {
            const active = pathname.startsWith(`/${s.id}`);
            return (
              <Link
                key={s.id}
                href={`/${s.id}/${s.firstSystem}`}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-muted",
                  active ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground",
                )}
              >
                {s.name}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex min-w-0 flex-1 justify-end md:flex-none md:w-[420px]">
          <SearchCommand items={searchIndex} />
        </div>

        <LocaleSwitch />
        <a
          href="https://github.com/ketbome/vet-atlas"
          className="hidden rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground sm:block"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
      </div>
    </header>
  );
}
