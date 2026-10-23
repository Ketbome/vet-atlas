"use client";

import { useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckIcon, GlobeIcon } from "lucide-react";
import { getPathname, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const KEY = "locale";
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function href(locale: string, pathname: string) {
  const path = getPathname({ href: pathname, locale });
  return `${base}${path.endsWith("/") ? path : `${path}/`}`;
}

function nativeName(locale: string) {
  const name = new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}

function readPref() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

// Each locale is its own root layout, so switching is a full page load. The
// choice is remembered; without one, the browser language picks on first visit.
export function LocaleSwitch() {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("nav");

  useEffect(() => {
    const browser = navigator.language.slice(0, 2);
    const wanted = readPref() ?? (routing.locales.some((l) => l === browser) ? browser : null);
    if (wanted && wanted !== locale && routing.locales.some((l) => l === wanted)) {
      location.replace(href(wanted, pathname) + location.search + location.hash);
    }
    // Only on arrival: later navigations keep the locale of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choose(l: string) {
    try {
      localStorage.setItem(KEY, l);
    } catch {}
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("language")}
        className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:bg-muted data-[state=open]:text-foreground"
      >
        <GlobeIcon className="size-4" aria-hidden="true" />
        <span className="hidden text-xs font-medium uppercase tracking-wide sm:inline">{locale}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-40">
        {routing.locales.map((l) => (
          <DropdownMenuItem key={l} asChild>
            <a href={href(l, pathname)} hrefLang={l} lang={l} aria-current={l === locale ? "true" : undefined} onClick={() => choose(l)}>
              <span className="flex-1">{nativeName(l)}</span>
              {l === locale && <CheckIcon className="text-mark" aria-hidden="true" />}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
