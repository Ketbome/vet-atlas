import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { loadContent, pathologyHref, structureHref, systemHref } from "@/lib/content/load";
import { localeUrl } from "@/lib/seo";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const db = loadContent();
  const species = db.species.filter((s) => s.status === "published");
  const systems = db.systems.filter((s) => s.status === "published" && species.some((sp) => sp.id === s.species));
  const structures = db.structures.filter((st) => systems.some((s) => s.id === st.system));

  const paths = [
    "/",
    ...species.map((s) => `/${s.id}`),
    ...systems.map(systemHref),
    ...structures.map(structureHref),
    ...db.pathologies.map(pathologyHref),
  ];

  return paths.flatMap((path) => {
    const languages = Object.fromEntries(routing.locales.map((l) => [l, localeUrl(l, path)]));
    return routing.locales.map((l) => ({ url: languages[l], alternates: { languages } }));
  });
}
