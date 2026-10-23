import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRightIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadContent, localeName, systemHref } from "@/lib/content/load";
import { buildViewerModel } from "@/lib/content/view";
import { SiteFooter } from "@/components/atlas/site-footer";
import { HeroViewer } from "@/components/atlas/hero-viewer";
import { SearchButton } from "@/components/atlas/search-button";
import { JsonLd } from "@/components/atlas/json-ld";
import { alternates, localeUrl } from "@/lib/seo";

function roman(n: number) {
  return ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][n - 1] ?? String(n);
}

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "seo" });
  return {
    title: { absolute: t("homeTitle") },
    alternates: alternates(locale, "/"),
  };
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const tSite = await getTranslations("site");
  const tSeo = await getTranslations("seo");
  const tLayer = await getTranslations("viewer.layerName");
  const db = loadContent();
  const published = db.species.filter((s) => s.status === "published");
  const upcoming = db.species.filter((s) => s.status !== "published");
  // The frontispiece shows the skeleton: the base every other layer sits on.
  const featured =
    db.systems.find((s) => s.species === published[0]?.id && s.status === "published" && s.material === "bone") ??
    db.systems.find((s) => s.species === published[0]?.id && s.status === "published");

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: tSite("name"),
          url: localeUrl(locale, "/"),
          inLanguage: locale,
          description: tSeo("homeDescription"),
        }}
      />
      <main id="content" className="mx-auto w-full max-w-[1180px] px-4 sm:px-6">
        <section className="grid gap-10 py-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-center lg:py-16">
          <div>
            <h1 className="font-display text-[44px] leading-[1.02] tracking-[-0.02em] text-ink sm:text-[56px] lg:text-[68px]">{t("title")}</h1>
            <p className="mt-6 max-w-[54ch] text-lg leading-relaxed text-muted-foreground">{t("lead")}</p>
            {/* One way in through the specimen on the plate, one through search;
                every species is in the index below. */}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {featured && (
                <Link
                  href={systemHref(featured)}
                  className="inline-flex h-12 items-center gap-2 rounded-[3px] bg-primary px-6 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {t("start", { species: localeName(published[0].name, locale) })}
                  <ArrowRightIcon className="size-4" />
                </Link>
              )}
              <SearchButton label={t("searchAll", { count: db.structures.length })} />
            </div>
          </div>

          {featured && (
            <HeroViewer
              model={buildViewerModel(featured, locale)}
              caption={t("plateCaption", {
                latin: published[0].scientificName,
                system: localeName(featured.name, locale),
              })}
            />
          )}
        </section>

        <section aria-labelledby="index-title" className="border-t border-rule py-10">
          <h2 id="index-title" className="plate-label">
            {t("index")}
          </h2>
          <ol className="mt-4">
            {published.map((sp, i) => {
              // Deepest layer first: the skeleton is where most students start.
              const systems = db.systems.filter((s) => s.species === sp.id && s.status === "published").sort((a, b) => b.order - a.order);
              const structures = db.structures.filter((st) => systems.some((s) => s.id === st.system)).length;
              const pathologies = db.pathologies.filter((p) => p.species.includes(sp.id)).length;
              return (
                <li
                  key={sp.id}
                  className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 border-b border-border py-4 md:grid-cols-[2.5rem_minmax(0,1fr)_auto_auto]"
                >
                  <span className="font-heading text-sm italic text-muted-foreground">{roman(i + 1)}</span>
                  <Link
                    href={systems[0] ? systemHref(systems[0]) : `/${sp.id}`}
                    className="group min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="font-heading text-2xl text-ink group-hover:underline group-hover:decoration-mark group-hover:underline-offset-4">{localeName(sp.name, locale)}</span>{" "}
                    <span lang="la" className="nav-latin text-base text-muted-foreground">
                      {sp.scientificName}
                    </span>
                  </Link>
                  <ul className="col-start-2 flex flex-wrap gap-x-3 text-sm md:col-start-auto" aria-label={localeName(sp.name, locale)}>
                    {systems.map((s) => (
                      <li key={s.id}>
                        <Link
                          href={systemHref(s)}
                          title={localeName(s.name, locale)}
                          className="inline-flex min-h-8 items-center gap-1.5 text-muted-foreground hover:text-foreground hover:underline hover:decoration-mark hover:underline-offset-4"
                        >
                          <span className="size-2 rounded-[1px] border border-ink/15" style={{ background: s.color }} aria-hidden="true" />
                          {tLayer(s.material)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <span className="tabular col-start-2 text-sm whitespace-nowrap text-muted-foreground md:col-start-auto md:pl-6 md:text-right md:text-foreground">
                    {t("structuresCount", { count: structures })} · {t("pathologiesCount", { count: pathologies })}
                  </span>
                </li>
              );
            })}
            {upcoming.map((sp, i) => (
              <li key={sp.id} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-border py-4 text-muted-foreground">
                <span className="font-heading text-sm italic">{roman(published.length + i + 1)}</span>
                <span>
                  <span className="font-heading text-2xl">{localeName(sp.name, locale)}</span>{" "}
                  <span lang="la" className="nav-latin text-base">
                    {sp.scientificName}
                  </span>
                </span>
                <span className="text-sm">{t("soon")}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
