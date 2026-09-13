import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSpecies, getStructuresOfSystem, loadContent, localeName, systemHref } from "@/lib/content/load";
import { SiteFooter } from "@/components/atlas/site-footer";

export function generateStaticParams() {
  return loadContent().species.map((s) => ({ species: s.id }));
}

export async function generateMetadata({ params }: PageProps<"/[locale]/[species]">): Promise<Metadata> {
  const { locale, species } = await params;
  const sp = getSpecies(species);
  return sp ? { title: localeName(sp.name, locale) } : {};
}

export default async function SpeciesPage({ params }: PageProps<"/[locale]/[species]">) {
  const { locale, species } = await params;
  setRequestLocale(locale);
  const sp = getSpecies(species);
  if (!sp) notFound();
  const t = await getTranslations("species");
  const th = await getTranslations("home");
  const systems = loadContent().systems.filter((s) => s.species === sp.id);

  return (
    <>
      <main className="mx-auto w-full max-w-[1100px] px-4 py-10">
        <p className="nav-latin text-sm text-muted-foreground">{sp.scientificName}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{localeName(sp.name, locale)}</h1>
        <h2 className="mt-8 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("systems")}</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {systems.map((s) => {
            const count = getStructuresOfSystem(s.id).length;
            return (
              <li key={s.id}>
                <Link href={systemHref(s)} className="block rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent/30">
                  <span className="block font-heading text-lg font-semibold">{localeName(s.name, locale)}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {s.status === "published" ? th("structuresCount", { count }) : t("systemSoon")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </main>
      <SiteFooter />
    </>
  );
}
