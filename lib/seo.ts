import { routing, type Locale } from "@/i18n/routing";

// Absolute origin plus base path of the deployed site, set by the Pages workflow.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://vet-atlas.ketbome.com").replace(/\/$/, "");

// path is locale-free and starts with "/" (as structureHref and friends).
export function localeUrl(locale: string, path: string) {
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  const url = `${SITE_URL}${prefix}${path}`;
  return url.endsWith("/") ? url : `${url}/`;
}

export function alternates(locale: string, path: string) {
  return {
    canonical: localeUrl(locale, path),
    languages: {
      ...Object.fromEntries(routing.locales.map((l) => [l, localeUrl(l, path)])),
      "x-default": localeUrl(routing.defaultLocale, path),
    } as Record<Locale | "x-default", string>,
  };
}

export function breadcrumbLd(locale: string, items: { path: string; name: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: localeUrl(locale, item.path),
    })),
  };
}
