import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BoneIcon, ExternalLinkIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getMedia, getPathology, getSpecies, getStructure, getSystemById, loadContent, localeName, readDoc, structureHref } from "@/lib/content/load";
import type { Media } from "@/lib/content/schema";
import { Doc } from "@/components/atlas/mdx";
import { ReviewBadge } from "@/components/atlas/review-badge";
import { MediaGallery } from "@/components/atlas/media-gallery";
import { SiteFooter } from "@/components/atlas/site-footer";
import { Badge } from "@/components/ui/badge";

const REPO = "https://github.com/ketbome/vet-atlas/edit/main/content";

export function generateStaticParams() {
  return loadContent().pathologies.map((p) => ({ slug: p.id }));
}

export async function generateMetadata({ params }: PageProps<"/[locale]/pathologies/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;
  const p = getPathology(slug);
  if (!p) return {};
  const doc = readDoc(p.dir, locale);
  return { title: doc?.title ?? slug, description: doc?.summary };
}

export default async function PathologyPage({ params }: PageProps<"/[locale]/pathologies/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const pathology = getPathology(slug);
  if (!pathology) notFound();
  const doc = readDoc(pathology.dir, locale);
  if (!doc) notFound();

  const t = await getTranslations("pathology");
  const ts = await getTranslations("structure");
  const tSite = await getTranslations("site");
  const media = pathology.media.map(getMedia).filter((m): m is Media => Boolean(m));
  const structures = pathology.structures.map(getStructure).filter((s) => s !== undefined);
  const speciesNames = pathology.species.map((id) => getSpecies(id)).filter((s) => s !== undefined);

  return (
    <>
      <main id="content" className="mx-auto w-full max-w-[1100px] px-4 py-8 lg:py-12">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
          <article>
            <h1 className="font-display text-[38px] leading-[1.05] text-ink lg:text-[48px]">{doc.title}</h1>
            <p className="mt-3 max-w-[62ch] text-base leading-relaxed text-foreground/85">{doc.summary}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge className="bg-eosin-soft text-eosin border-eosin/30">
                {t("title")} · {t(`category.${pathology.category}`)}
              </Badge>
              {speciesNames.map((s) => (
                <Badge key={s.id} variant="outline">
                  {localeName(s.name, locale)}
                </Badge>
              ))}
            </div>
            <div className="mt-4">
              <ReviewBadge review={pathology.review} />
            </div>
            {doc.fallback && <p className="mt-2 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">{ts("untranslated")}</p>}

            <div className="mt-8 max-w-[68ch]">
              <Doc source={doc.body} />
            </div>

            {pathology.references.length > 0 && (
              <section className="mt-10 border-t border-border pt-4">
                <h2 className="text-sm font-semibold">{t("references")}</h2>
                <ol className="mt-2 max-w-[68ch] list-decimal space-y-1 pl-5 text-sm text-foreground/85">
                  {pathology.references.map((r, i) => (
                    <li key={i}>
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-primary">
                          {r.title}
                        </a>
                      ) : (
                        r.title
                      )}
                      {r.year ? ` (${r.year})` : ""}
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
              <span className="max-w-[60ch]">{tSite("disclaimer")}</span>
              <a href={`${REPO}/pathologies/${slug}/${doc.locale}.mdx`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap hover:text-foreground">
                {tSite("editOnGithub")} <ExternalLinkIcon className="size-3" />
              </a>
            </footer>
          </article>

          <aside className="space-y-8">
            <section>
              <h2 className="text-sm font-semibold">{t("affectedStructures")}</h2>
              <ul className="mt-2 space-y-1.5">
                {structures.map((s) => {
                  const system = getSystemById(s.system);
                  const sp = system ? getSpecies(system.species) : undefined;
                  return (
                    <li key={s.id}>
                      <Link href={structureHref(s)} className="group flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:border-primary/50 hover:bg-accent/40">
                        <BoneIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block font-medium group-hover:text-primary">{readDoc(s.dir, locale)?.title ?? s.nav}</span>
                          <span lang="la" className="nav-latin block truncate text-xs text-muted-foreground">
                            {s.nav}
                            {sp ? ` · ${localeName(sp.name, locale)}` : ""}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
            <section>
              <h2 className="text-sm font-semibold">{ts("media")}</h2>
              <div className="mt-2">
                <MediaGallery items={media} locale={locale} emptyText={ts("noMedia")} />
              </div>
            </section>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
