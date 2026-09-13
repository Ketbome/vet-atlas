import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ExternalLinkIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getMedia, getSpecies, getStructure, getSystem, loadContent, localeName, readDoc, structureHref, structureSlug } from "@/lib/content/load";
import { pathologySummaries } from "@/lib/content/view";
import type { Media } from "@/lib/content/schema";
import { Doc } from "@/components/atlas/mdx";
import { ReviewBadge } from "@/components/atlas/review-badge";
import { MediaGallery } from "@/components/atlas/media-gallery";
import { PathologyList } from "@/components/atlas/pathology-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  return { title: doc ? `${doc.title} (${s.nav})` : s.nav, description: doc?.summary };
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
  const pathologies = pathologySummaries(structure.pathologies, locale);
  const media = structure.media.map(getMedia).filter((m): m is Media => Boolean(m));
  const related = structure.related.map(getStructure).filter((r) => r !== undefined);

  return (
    <article className="p-5 lg:p-6">
      <header>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {localeName(sp.name, locale)} · {localeName(system.name, locale)}
        </p>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight">{doc.title}</h1>
        <p className="nav-latin mt-0.5 text-base text-muted-foreground" title={t("nav")}>
          {structure.nav}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-foreground/85">{doc.summary}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{t(`laterality.${structure.laterality}`)}</span>
        </div>
        <div className="mt-3">
          <ReviewBadge review={structure.review} />
        </div>
        {doc.fallback && <p className="mt-2 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">{t("untranslated")}</p>}
      </header>

      <Tabs defaultValue="description" className="mt-5">
        <TabsList className="w-full">
          <TabsTrigger value="description" className="flex-1">{t("description")}</TabsTrigger>
          <TabsTrigger value="pathologies" className="flex-1">
            {t("pathologies")} <span className="ml-1 text-muted-foreground">{pathologies.length}</span>
          </TabsTrigger>
          <TabsTrigger value="media" className="flex-1">
            {t("media")} <span className="ml-1 text-muted-foreground">{media.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="description" className="pt-4">
          <Doc source={doc.body} />
        </TabsContent>
        <TabsContent value="pathologies" className="pt-4">
          <PathologyList items={pathologies} emptyText={t("noPathologies")} />
        </TabsContent>
        <TabsContent value="media" className="pt-4">
          <MediaGallery items={media} locale={locale} emptyText={t("noMedia")} />
        </TabsContent>
      </Tabs>

      {related.length > 0 && (
        <section className="mt-8 border-t border-border pt-4">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("related")}</h2>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {related.map((r) => (
              <li key={r.id}>
                <Link href={structureHref(r)} className="inline-flex items-baseline gap-1.5 rounded-md border border-border px-2 py-1 text-sm hover:bg-muted">
                  {readDoc(r.dir, locale)?.title ?? r.nav}
                  <span className="nav-latin text-xs text-muted-foreground">{r.nav}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-8 flex items-center justify-between border-t border-border pt-4 text-xs text-muted-foreground">
        <span>{tSite("disclaimer")}</span>
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
