import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { fontVariables } from "@/components/atlas/fonts";
import { Logo } from "@/components/atlas/logo";
import "./globals.css";

// Becomes 404.html, which GitHub Pages serves for every missing path. It sits
// outside the [locale] tree, so it renders its own document with plain links.
export default async function NotFound() {
  const locale = routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "errors" });
  const tSite = await getTranslations({ locale, namespace: "site" });
  const home = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`;

  return (
    <html lang={locale} className={`${fontVariables} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <header className="h-14 border-b border-border">
          <a href={home} className="mx-auto flex h-full max-w-[1600px] items-center gap-2 px-3 sm:px-4">
            <Logo className="size-8" />
            <span className="font-display text-[21px] leading-none tracking-[-0.01em]">{tSite("name")}</span>
          </a>
        </header>
        <main id="content" className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col items-start justify-center gap-4 px-4 py-16">
          <h1 className="font-display text-[34px] leading-tight text-ink">{t("notFoundTitle")}</h1>
          <p className="max-w-[56ch] text-muted-foreground">{t("notFoundBody")}</p>
          <a href={home} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/85">
            {t("home")}
          </a>
        </main>
      </body>
    </html>
  );
}
