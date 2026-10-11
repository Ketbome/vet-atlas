import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSpecies, getStructuresOfSystem, getSystem, localeName, readDoc, structureHref } from "@/lib/content/load";
import { pathologySummaries } from "@/lib/content/view";
import { Breadcrumb } from "@/components/atlas/breadcrumb";
import { ShortcutKbd } from "@/components/atlas/shortcut-kbd";
import { PathologyList } from "@/components/atlas/pathology-list";

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
  const tSite = await getTranslations("site");
  const structures = getStructuresOfSystem(system.id);
  const pathologyIds = new Set(structures.flatMap((s) => s.pathologies));

  return (
    <div className="flex min-h-full flex-col p-4 sm:p-5 lg:p-6">
      <Breadcrumb items={[{ href: `/${sp.id}`, label: localeName(sp.name, locale) }]} />
      <h1 className="mt-2 font-display text-[32px] leading-tight text-ink">{localeName(system.name, locale)}</h1>
      <p className="tabular mt-1 text-sm text-muted-foreground">
        {t("structuresCount", { count: structures.length })} · {t("pathologiesCount", { count: pathologyIds.size })}
      </p>

      <dl className="mt-6 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 border-y border-border py-4 text-sm">
        <dt className="plate-label pt-0.5">{t("howTo.find")}</dt>
        <dd>{t.rich("howToSteps.search", { kbd: () => <ShortcutKbd /> })}</dd>
        <dt className="plate-label pt-0.5">{t("howTo.open")}</dt>
        <dd>{t("howToSteps.click")}</dd>
        <dt className="plate-label pt-0.5">{t("howTo.dissect")}</dt>
        <dd>{t("howToSteps.layers")}</dd>
      </dl>

      {/* On wide screens the same list is the sidebar tree. */}
      <div className="lg:hidden">
        <h2 className="mt-8 font-heading text-lg text-ink">{ts("inSystem", { system: localeName(system.name, locale) })}</h2>
        {system.regions.map((region) => {
          const items = structures.filter((s) => s.region === region.id);
          if (items.length === 0) return null;
          return (
            <section key={region.id} className="mt-4">
              <h3 className="font-heading text-base italic text-ink">{localeName(region.name, locale)}</h3>
              <ul className="mt-1 grid grid-cols-1 sm:grid-cols-2">
                {items.map((s) => {
                  const doc = readDoc(s.dir, locale);
                  return (
                    <li key={s.id}>
                      <Link href={structureHref(s)} className="flex min-h-10 items-baseline gap-2.5 border-b border-border px-1 py-2 text-sm hover:bg-muted">
                        <span className="size-2.5 shrink-0 translate-y-px rounded-[2px] border border-ink/15" style={{ background: s.color ?? system.color }} aria-hidden="true" />
                        <span className="min-w-0 flex-1">{doc?.title ?? s.nav}</span>
                        <span lang="la" className="nav-latin max-w-[50%] truncate text-right text-xs text-muted-foreground" title={s.nav}>
                          {s.nav}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {pathologyIds.size > 0 && (
        <section className="mt-8">
          <h2 className="font-heading text-lg text-ink">{ts("pathologies")}</h2>
          <div className="mt-3">
            <PathologyList items={pathologySummaries([...pathologyIds], locale)} emptyText={ts("noPathologies")} />
          </div>
        </section>
      )}

      <p className="mt-auto max-w-[60ch] pt-8 text-xs text-muted-foreground">{tSite("disclaimer")}</p>
    </div>
  );
}
