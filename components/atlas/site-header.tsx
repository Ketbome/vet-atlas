"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import type { SearchItem } from "@/lib/content/load";
import { SearchCommand } from "./search-command";
import { LocaleSwitch } from "./locale-switch";
import { FeedbackButton } from "./feedback-button";
import { Logo } from "./logo";
import { cn } from "@/lib/utils";

type Props = {
  species: { id: string; name: string; firstSystem: string }[];
  searchIndex: SearchItem[];
};

export function SiteHeader({ species, searchIndex }: Props) {
  const t = useTranslations("site");
  const tn = useTranslations("nav");
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-background">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        {tn("skip")}
      </a>
      <div className="mx-auto flex h-full max-w-[1600px] items-center gap-2 px-3 sm:gap-3 sm:px-4">
        <Link href="/" className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={t("name")}>
          <Logo className="size-8" />
          <span className="hidden font-display text-[21px] leading-none tracking-[-0.01em] sm:inline">{t("name")}</span>
        </Link>

        <nav className="ml-2 hidden items-center gap-1 md:flex" aria-label={tn("species")}>
          {species.map((s) => {
            const active = pathname.startsWith(`/${s.id}`);
            return (
              <Link
                key={s.id}
                href={`/${s.id}/${s.firstSystem}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative px-2.5 py-1.5 text-sm transition-colors hover:text-foreground",
                  active
                    ? "font-medium text-foreground after:absolute after:inset-x-2.5 after:-bottom-[13px] after:h-0.5 after:bg-mark"
                    : "text-muted-foreground",
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

        <FeedbackButton />
        <LocaleSwitch />
        <a
          href="https://github.com/ketbome/vet-atlas"
          className="rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          target="_blank"
          rel="noreferrer"
          aria-label={tn("github")}
        >
          GitHub
        </a>
      </div>
    </header>
  );
}
