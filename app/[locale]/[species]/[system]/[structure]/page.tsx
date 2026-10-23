import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BoxIcon, ExternalLinkIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getMedia, getSource, getSpecies, getStructure, getSystem, loadContent, localeName, readDoc, structureHref, structureSlug, systemHref } from "@/lib/content/load";
import { pathologySummaries } from "@/lib/content/view";
import type { Media } from "@/lib/content/schema";
import { Doc } from "@/components/atlas/mdx";
import { ReviewBadge } from "@/components/atlas/review-badge";
import { MediaGallery } from "@/components/atlas/media-gallery";
import { PathologyList } from "@/components/atlas/pathology-list";
import { StructureTabs } from "@/components/atlas/structure-tabs";
import { Breadcrumb } from "@/components/atlas/breadcrumb";
import { JsonLd } from "@/components/atlas/json-ld";
import { alternates, breadcrumbLd } from "@/lib/seo";

const REPO = "https://github.com/ketbome/vet-atlas/edit/main/content";

export function generateStaticParams() {
  return loadContent().structures.map((s) => {
    const [species, system] = s.id.split(".");
    return { species, system, structure: structureSlug(s) };
  });
}

export async function generateMetadata({ params }: PageProps<"/[locale]/[species]/[system]/[structure]">): Promise<Metadata> {
  const { locale, species, system, structure } = await params;
  const s = getStructure(`${species}.${system}.${structure}`);
  if (!s) return {};
  const doc = readDoc(s.dir, locale);
  const sp = getSpecies(species);
  // Latin name too, unless the title already carries it ("Atlas (C1)").
  const title = !doc ? s.nav : doc.title.toLowerCase().includes(s.nav.toLowerCase()) ? doc.title : `${doc.title} (${s.nav})`;
  return {
    title: sp ? `${title} · ${localeName(sp.name, locale)}` : title,
    description: doc?.summary,
    alternates: alternates(locale, structureHref(s)),
  };
}

export default async function StructurePage({ params }: PageProps<"/[locale]/[species]/[system]/[structure]">) {
  const { locale, species, system: systemSlug, structure: slug } = await params;
  setRequestLocale(locale);
  const structure = getStructure(`${species}.${systemSlug}.${slug}`);
  const system = getSystem(species, systemSlug);
  const sp = getSpecies(species);
  if (!structure || !system || !sp) notFound();
  const doc = readDoc(structure.dir, locale);
  if (!doc) notFound();

  const t = await getTranslations("structure");
  const tSite = await getTranslations("site");
  const tViewer = await getTranslations("viewer");
  const pathologies = pathologySummaries(structure.pathologies, locale);
  const media = structure.media.map(getMedia).filter((m): m is Media => Boolean(m));
  const related = structure.related.map(getStructure).filter((r) => r !== undefined);
  const source = structure.source ? getSource(structure.source) : undefined;

  return (
    <article className="p-4 sm:p-5 lg:p-6">
      <JsonLd
        data={breadcrumbLd(locale, [
          { path: `/${sp.id}`, name: localeName(sp.name, locale) },
          { path: systemHref(system), name: localeName(system.name, locale) },
          { path: structureHref(structure), name: doc.title },
        ])}
      />
      <header>
        <Breadcrumb
          items={[
            { href: `/${sp.id}`, label: localeName(sp.name, locale) },
            { href: systemHref(system), label: localeName(system.name, locale) },
          ]}
        />
        <h1 className="mt-2 font-display text-[34px] leading-[1.05] text-ink">{doc.title}</h1>
        <p lang="la" className="nav-latin mt-1 text-lg text-muted-foreground" title={t("nav")}>
          {structure.nav}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-foreground/85">{doc.summary}</p>
        <dl className="mt-3 flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
          <dt>{t("laterality_label")}:</dt>
          <dd className="text-foreground/80">{t(`laterality.${structure.laterality}`)}</dd>
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ReviewBadge review={structure.review} />
          <Link
            href={`/3d${structureHref(structure)}`}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <BoxIcon className="size-3.5" aria-hidden />
            {tViewer("pieceView")}
          </Link>
        </div>
        {structure.fidelity === "illustrative" && <p className="mt-2 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">{t("illustrative")}</p>}
        {source && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("modelSource")}:{" "}
            <a href={source.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
              {source.name}
            </a>
            , {source.license}
          </p>
        )}
        {doc.fallback && <p className="mt-2 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">{t("untranslated")}</p>}
      </header>

      <StructureTabs
        counts={{ pathologies: pathologies.length, media: media.length }}
        description={<Doc source={doc.body} />}
        pathologies={<PathologyList items={pathologies} emptyText={t("noPathologies")} />}
        media={<MediaGallery items={media} locale={locale} emptyText={t("noMedia")} />}
      />

      {related.length > 0 && (
        <section className="mt-8 border-t border-border pt-4">
          <h2 className="text-sm font-semibold">{t("related")}</h2>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {related.map((r) => (
              <li key={r.id}>
                <Link href={structureHref(r)} className="inline-flex min-h-9 items-baseline gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-muted">
                  {readDoc(r.dir, locale)?.title ?? r.nav}
                  <span lang="la" className="nav-latin text-xs text-muted-foreground">
                    {r.nav}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
        <span className="max-w-[60ch]">{tSite("disclaimer")}</span>
        <a
          href={`${REPO}/species/${species}/structures/${slug}/${doc.locale}.mdx`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 whitespace-nowrap hover:text-foreground"
        >
          {tSite("editOnGithub")} <ExternalLinkIcon className="size-3" />
        </a>
      </footer>
    </article>
  );
}
