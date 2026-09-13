import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import {
  frontmatterSchema,
  mediaSchema,
  pathologySchema,
  sourceSchema,
  speciesSchema,
  structureSchema,
  systemSchema,
  type Frontmatter,
  type Media,
  type Pathology,
  type Source,
  type Species,
  type Structure,
  type System,
} from "./schema";

export const CONTENT_DIR = path.join(process.cwd(), "content");

export type Entry<T> = T & { dir: string };

export type ContentDb = {
  species: Entry<Species>[];
  systems: Entry<System>[];
  structures: Entry<Structure>[];
  pathologies: Entry<Pathology>[];
  media: Media[];
  sources: Source[];
};

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(dir, d.name));
}

function listFiles(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .map((f) => path.join(dir, f));
}

let cache: ContentDb | null = null;

export function loadContent(): ContentDb {
  if (cache && process.env.NODE_ENV === "production") return cache;

  const sources = (readJson(path.join(CONTENT_DIR, "sources.json")) as unknown[]).map((s) =>
    sourceSchema.parse(s),
  );

  const species: Entry<Species>[] = [];
  const systems: Entry<System>[] = [];
  const structures: Entry<Structure>[] = [];
  const media: Media[] = [];

  for (const dir of listDirs(path.join(CONTENT_DIR, "species"))) {
    species.push({ ...speciesSchema.parse(readJson(path.join(dir, "species.json"))), dir });

    for (const file of listFiles(path.join(dir, "systems"), ".json")) {
      systems.push({ ...systemSchema.parse(readJson(file)), dir: path.dirname(file) });
    }
    for (const sdir of listDirs(path.join(dir, "structures"))) {
      structures.push({ ...structureSchema.parse(readJson(path.join(sdir, "meta.json"))), dir: sdir });
    }
    const mediaFile = path.join(dir, "media.json");
    if (fs.existsSync(mediaFile)) {
      for (const m of readJson(mediaFile) as unknown[]) media.push(mediaSchema.parse(m));
    }
  }

  const pathologies: Entry<Pathology>[] = listDirs(path.join(CONTENT_DIR, "pathologies")).map(
    (pdir) => ({ ...pathologySchema.parse(readJson(path.join(pdir, "meta.json"))), dir: pdir }),
  );

  cache = { species, systems, structures, pathologies, media, sources };
  return cache;
}

export function getSpecies(id: string) {
  return loadContent().species.find((s) => s.id === id);
}

export function getSystem(speciesId: string, slug: string) {
  return loadContent().systems.find((s) => s.species === speciesId && s.slug === slug);
}

export function getSystemById(id: string) {
  return loadContent().systems.find((s) => s.id === id);
}

export function getStructuresOfSystem(systemId: string) {
  return loadContent().structures.filter((s) => s.system === systemId);
}

export function getStructure(id: string) {
  return loadContent().structures.find((s) => s.id === id);
}

export function structureSlug(structure: Structure) {
  return structure.id.split(".")[2];
}

export function getPathology(id: string) {
  return loadContent().pathologies.find((p) => p.id === id);
}

export function getMedia(id: string) {
  return loadContent().media.find((m) => m.id === id);
}

export function getSource(id: string) {
  return loadContent().sources.find((s) => s.id === id);
}

export type LocalizedDoc = Frontmatter & {
  body: string;
  locale: string;
  fallback: boolean;
};

export function readDoc(dir: string, locale: string, fallbackLocale = "en"): LocalizedDoc | null {
  const candidates = [locale, fallbackLocale, "es", "en"];
  for (const l of candidates) {
    const file = path.join(dir, `${l}.mdx`);
    if (!fs.existsSync(file)) continue;
    const { data, content } = matter(fs.readFileSync(file, "utf8"));
    return { ...frontmatterSchema.parse(data), body: content, locale: l, fallback: l !== locale };
  }
  return null;
}

export function docTitle(dir: string, locale: string) {
  return readDoc(dir, locale)?.title ?? dir.split(path.sep).at(-1) ?? "";
}

export function localeName(text: Record<string, string>, locale: string) {
  return text[locale] ?? text.en ?? Object.values(text)[0] ?? "";
}

export function structureHref(structure: Structure) {
  const [species, system, slug] = structure.id.split(".");
  return `/${species}/${system}/${slug}`;
}

export function systemHref(system: System) {
  return `/${system.species}/${system.slug}`;
}

export function pathologyHref(p: Pathology) {
  return `/pathologies/${p.id}`;
}

export type SearchItem = {
  type: "structure" | "pathology";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  keywords: string[];
};

export function getSearchIndex(locale: string): SearchItem[] {
  const db = loadContent();
  const otherLocales = ["es", "en"].filter((l) => l !== locale);
  const items: SearchItem[] = [];

  for (const s of db.structures) {
    const doc = readDoc(s.dir, locale);
    if (!doc) continue;
    const system = getSystemById(s.system);
    const species = system ? getSpecies(system.species) : undefined;
    items.push({
      type: "structure",
      id: s.id,
      title: doc.title,
      subtitle: [s.nav, species ? localeName(species.name, locale) : ""].filter(Boolean).join(" · "),
      href: structureHref(s),
      keywords: [s.nav, ...otherLocales.map((l) => readDoc(s.dir, l)?.title ?? "")].filter(Boolean),
    });
  }

  for (const p of db.pathologies) {
    const doc = readDoc(p.dir, locale);
    if (!doc) continue;
    items.push({
      type: "pathology",
      id: p.id,
      title: doc.title,
      subtitle: doc.summary,
      href: pathologyHref(p),
      keywords: otherLocales.map((l) => readDoc(p.dir, l)?.title ?? "").filter(Boolean),
    });
  }

  return items;
}
