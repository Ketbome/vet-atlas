import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRightIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadContent, localeName, systemHref } from "@/lib/content/load";
import { SiteFooter } from "@/components/atlas/site-footer";
import { Kbd } from "@/components/ui/kbd";
import { Badge } from "@/components/ui/badge";

const upcoming = [
  { id: "cat", scientificName: "Felis catus", name: { es: "Gato", en: "Cat" } },
  { id: "cow", scientificName: "Bos taurus", name: { es: "Vaca", en: "Cow" } },
  { id: "horse", scientificName: "Equus caballus", name: { es: "Caballo", en: "Horse" } },
];

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const db = loadContent();
  const published = db.species.filter((s) => s.status === "published");

  return (
    <>
      <main className="mx-auto w-full max-w-[1100px] px-4">
        <section className="grid gap-8 py-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end lg:py-20">
          <div>
            <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight lg:text-[56px]">{t("title")}</h1>
            <p className="mt-5 max-w-[56ch] text-lg leading-relaxed text-muted-foreground">{t("lead")}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {published.map((sp) => {
                const system = db.systems.find((s) => s.species === sp.id);
                if (!system) return null;
                return (
                  <Link
                    key={sp.id}
                    href={systemHref(system)}
                    className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {t("start", { species: localeName(sp.name, locale) })}
                    <ArrowRightIcon className="size-4" />
                  </Link>
                );
              })}
              <span className="hidden text-sm text-muted-foreground sm:inline">
                <Kbd>⌘</Kbd> <Kbd>K</Kbd>
              </span>
            </div>
          </div>

          <ol className="space-y-3 rounded-lg border border-border bg-card p-5 text-sm">
            <li className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("howTo")}</li>
            <li className="flex gap-3">
              <span className="size-5 shrink-0 rounded-full bg-primary text-center text-[11px] font-semibold leading-5 text-primary-foreground">1</span>
              <span>{t.rich("howToSteps.search", { kbd: (chunks) => <Kbd>{chunks}</Kbd> })}</span>
            </li>
            <li className="flex gap-3">
              <span className="size-5 shrink-0 rounded-full bg-primary text-center text-[11px] font-semibold leading-5 text-primary-foreground">2</span>
              <span>{t("howToSteps.click")}</span>
            </li>
            <li className="flex gap-3">
              <span className="size-5 shrink-0 rounded-full bg-primary text-center text-[11px] font-semibold leading-5 text-primary-foreground">3</span>
              <span>{t("howToSteps.layers")}</span>
            </li>
          </ol>
        </section>

        <section className="border-t border-border py-10">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {published.map((sp) => {
              const systems = db.systems.filter((s) => s.species === sp.id);
              const structures = db.structures.filter((st) => systems.some((s) => s.id === st.system)).length;
              const pathologies = db.pathologies.filter((p) => p.species.includes(sp.id)).length;
              return (
                <li key={sp.id}>
                  <Link href={`/${sp.id}`} className="block h-full rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent/30">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-heading text-xl font-semibold">{localeName(sp.name, locale)}</span>
                      <Badge className="bg-chart-3/20 text-foreground">{t("available")}</Badge>
                    </div>
                    <span className="nav-latin mt-0.5 block text-sm text-muted-foreground">{sp.scientificName}</span>
                    <span className="mt-3 block text-sm text-muted-foreground">
                      {t("structuresCount", { count: structures })} · {t("pathologiesCount", { count: pathologies })}
                    </span>
                  </Link>
                </li>
              );
            })}
            {upcoming.map((sp) => (
              <li key={sp.id} className="rounded-lg border border-dashed border-border p-4 text-muted-foreground">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-heading text-xl font-semibold">{localeName(sp.name, locale)}</span>
                  <Badge variant="outline">{t("soon")}</Badge>
                </div>
                <span className="nav-latin mt-0.5 block text-sm">{sp.scientificName}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
