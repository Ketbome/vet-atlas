import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getSystem, loadContent } from "@/lib/content/load";
import { buildViewerModel, systemHref } from "@/lib/content/view";
import { ViewerShell } from "@/components/viewer/viewer-shell";

export function generateStaticParams() {
  return loadContent().systems.map((s) => ({ species: s.species, system: s.slug }));
}

export default async function SystemLayout({ children, params }: LayoutProps<"/[locale]/[species]/[system]">) {
  const { locale, species, system: systemSlug } = await params;
  setRequestLocale(locale);
  const system = getSystem(species, systemSlug);
  if (!system) notFound();

  return (
    <ViewerShell model={buildViewerModel(system, locale)} systemHref={systemHref(system)}>
      {children}
    </ViewerShell>
  );
}
