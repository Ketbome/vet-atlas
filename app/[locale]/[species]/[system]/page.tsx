import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSpecies, getStructuresOfSystem, getSystem, localeName, readDoc, structureHref } from "@/lib/content/load";
import { Kbd } from "@/components/ui/kbd";

export async function generateMetadata({ params }: PageProps<"/[locale]/[species]/[system]">): Promise<Metadata> {
  const { locale, species, system: slug } = await params;
  const system = getSystem(species, slug);
  const sp = getSpecies(species);
  if (!system || !sp) return {};
  return { title: `${localeName(system.name, locale)} · ${localeName(sp.name, locale)}` };
}

export default async function SystemPage({ params }: PageProps<"/[locale]/[species]/[system]">) {
  const { locale, species, system: slug } = await params;
  setRequestLocale(locale);
  const system = getSystem(species, slug);
  const sp = getSpecies(species);
  if (!system || !sp) notFound();
  const t = await getTranslations("home");
  const ts = await getTranslations("structure");
  const structures = getStructuresOfSystem(system.id);
  const pathologyIds = new Set(structures.flatMap((s) => s.pathologies));

  return (
    <div className="p-5 lg:p-6">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{localeName(sp.name, locale)}</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{localeName(system.name, locale)}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("structuresCount", { count: structures.length })} · {t("pathologiesCount", { count: pathologyIds.size })}
      </p>

      <ol className="mt-6 space-y-3 text-sm">
        <li className="flex gap-3">
          <span className="mt-0.5 size-5 shrink-0 rounded-full bg-primary text-center text-[11px] font-semibold leading-5 text-primary-foreground">1</span>
          <span>{t.rich("howToSteps.search", { kbd: (chunks) => <Kbd>{chunks}</Kbd> })}</span>
        </li>
        <li className="flex gap-3">
          <span className="mt-0.5 size-5 shrink-0 rounded-full bg-primary text-center text-[11px] font-semibold leading-5 text-primary-foreground">2</span>
          <span>{t("howToSteps.click")}</span>
        </li>
        <li className="flex gap-3">
          <span className="mt-0.5 size-5 shrink-0 rounded-full bg-primary text-center text-[11px] font-semibold leading-5 text-primary-foreground">3</span>
          <span>{t("howToSteps.layers")}</span>
        </li>
      </ol>

      <h2 className="mt-8 text-sm font-semibold">{ts("inSystem", { system: localeName(system.name, locale) })}</h2>
      <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-1">
        {structures.map((s) => {
          const doc = readDoc(s.dir, locale);
          return (
            <li key={s.id}>
              <Link href={structureHref(s)} className="flex items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                <span>{doc?.title ?? s.nav}</span>
                <span className="nav-latin text-xs text-muted-foreground">{s.nav}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
