import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { getSearchIndex, loadContent, localeName } from "@/lib/content/load";
import { SiteHeader } from "@/components/atlas/site-header";
import { fontVariables } from "@/components/atlas/fonts";
import { SITE_URL, localeUrl } from "@/lib/seo";
import { TooltipProvider } from "@/components/ui/tooltip";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site" });
  const seo = await getTranslations({ locale, namespace: "seo" });
  return {
    metadataBase: new URL(`${SITE_URL}/`),
    title: { default: seo("homeTitle"), template: `%s · ${t("name")}` },
    description: seo("homeDescription"),
    applicationName: t("name"),
    openGraph: {
      type: "website",
      siteName: t("name"),
      locale,
      images: [{ url: `${localeUrl(locale, "/")}og.png`, width: 1200, height: 630, alt: t("tagline") }],
    },
    twitter: { card: "summary_large_image" },
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const db = loadContent();
  const species = db.species
    .filter((s) => s.status === "published")
    .map((s) => ({ id: s.id, name: localeName(s.name, locale), firstSystem: db.systems.find((x) => x.species === s.id)?.slug ?? "" }));
  const searchIndex = getSearchIndex(locale);

  return (
    <html lang={locale} className={`${fontVariables} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <NextIntlClientProvider>
          <TooltipProvider>
            <SiteHeader species={species} searchIndex={searchIndex} />
            {children}
          </TooltipProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
