import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getStructure, getSystem, loadContent, readDoc, structureHref, structureSlug } from "@/lib/content/load";
import { buildViewerModel } from "@/lib/content/view";
import { PieceViewer } from "@/components/viewer/piece-viewer";

export function generateStaticParams() {
  return loadContent().structures.map((s) => {
    const [species, system] = s.id.split(".");
    return { species, system, structure: structureSlug(s) };
  });
}

export async function generateMetadata({ params }: PageProps<"/[locale]/3d/[species]/[system]/[structure]">): Promise<Metadata> {
  const { locale, species, system, structure } = await params;
  const s = getStructure(`${species}.${system}.${structure}`);
  if (!s) return {};
  const doc = readDoc(s.dir, locale);
  return { title: `3D · ${doc?.title ?? s.nav}`, description: doc?.summary };
}

export default async function PiecePage({ params }: PageProps<"/[locale]/3d/[species]/[system]/[structure]">) {
  const { locale, species, system: systemSlug, structure: slug } = await params;
  setRequestLocale(locale);
  const structure = getStructure(`${species}.${systemSlug}.${slug}`);
  const system = getSystem(species, systemSlug);
  if (!structure || !system) notFound();
  const doc = readDoc(structure.dir, locale);

  return (
    <PieceViewer
      model={buildViewerModel(system, locale)}
      structureId={structure.id}
      title={doc?.title ?? structure.nav}
      nav={structure.nav}
      backHref={structureHref(structure)}
    />
  );
}
