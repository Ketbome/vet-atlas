import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSpecies, getStructuresOfSystem, loadContent, localeName, systemHref } from "@/lib/content/load";
import { SiteFooter } from "@/components/atlas/site-footer";
import { alternates } from "@/lib/seo";

export function generateStaticParams() {
  return loadContent().species.map((s) => ({ species: s.id }));
}

export async function generateMetadata({ params }: PageProps<"/[locale]/[species]">): Promise<Metadata> {
  const { locale, species } = await params;
  const sp = getSpecies(species);
  if (!sp) return {};
  const t = await getTranslations({ locale, namespace: "seo" });
  const name = localeName(sp.name, locale);
  const systems = loadContent()
    .systems.filter((s) => s.species === sp.id)
    .sort((a, b) => a.order - b.order)
    .map((s) => localeName(s.name, locale).toLocaleLowerCase(locale))
    .join(", ");
  return {
    title: t("speciesTitle", { species: name }),
    description: t("speciesDescription", { species: name, latin: sp.scientificName, systems }),
    alternates: alternates(locale, `/${sp.id}`),
  };
}

export default async function SpeciesPage({ params }: PageProps<"/[locale]/[species]">) {
  const { locale, species } = await params;
  setRequestLocale(locale);
  const sp = getSpecies(species);
  if (!sp) notFound();
  const t = await getTranslations("species");
  const th = await getTranslations("home");
  const systems = loadContent()
    .systems.filter((s) => s.species === sp.id)
    .sort((a, b) => a.order - b.order);

  return (
    <>
      <main id="content" className="mx-auto w-full max-w-[1100px] px-4 py-10 sm:px-6 lg:py-14">
        <h1 className="font-display text-[44px] leading-none text-ink">{localeName(sp.name, locale)}</h1>
        <p lang="la" className="nav-latin mt-2 text-xl text-muted-foreground">
          {sp.scientificName}
        </p>

        <h2 className="plate-label mt-10">{t("systems")}</h2>
        <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">{t("stackHint")}</p>
        {/* The systems as the dissection stack: superficial on top, bone at the base. */}
        <ol className="mt-4 border-t border-rule">
          {systems.map((s) => {
            const count = getStructuresOfSystem(s.id).length;
            return (
              <li key={s.id}>
                <Link
                  href={systemHref(s)}
                  className="group grid grid-cols-[0.5rem_minmax(0,1fr)_auto] items-center gap-x-4 border-b border-border py-4 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="h-10 w-2 rounded-[1px]" style={{ background: s.color }} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block font-heading text-2xl text-ink group-hover:underline group-hover:decoration-mark group-hover:underline-offset-4">{localeName(s.name, locale)}</span>
                    <span className="plate-label">{th(`layerOf`, { n: s.order + 1, total: systems.length })}</span>
                  </span>
                  <span className="tabular text-sm text-muted-foreground">
                    {s.status === "published" ? th("structuresCount", { count }) : t("systemSoon")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </main>
      <SiteFooter />
    </>
  );
}
