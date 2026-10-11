import type { Metadata } from "next";
import { Libre_Caslon_Display, Libre_Caslon_Text, Schibsted_Grotesk } from "next/font/google";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { getSearchIndex, loadContent, localeName } from "@/lib/content/load";
import { SiteHeader } from "@/components/atlas/site-header";
import { TooltipProvider } from "@/components/ui/tooltip";
import "../globals.css";

// Plate typography: Caslon for headings and Latin NAV names, as in the
// classic anatomy atlases; a sturdy grotesk for labels and UI.
const display = Libre_Caslon_Display({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
});
const heading = Libre_Caslon_Text({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-heading",
});
const sans = Schibsted_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site" });
  return {
    title: { default: t("name"), template: `%s · ${t("name")}` },
    description: t("tagline"),
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
    <html lang={locale} className={`${display.variable} ${heading.variable} ${sans.variable} h-full antialiased`}>
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
