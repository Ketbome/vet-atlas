import type { Material, ViewerModel } from "@/components/viewer/types";
import { meshKey } from "./mesh";
import {
  getPathology,
  getSource,
  getSpecies,
  getStructuresOfSystem,
  loadContent,
  localeName,
  pathologyHref,
  readDoc,
  structureHref,
  structureSlug,
  systemHref,
  type Entry,
} from "./load";
import type { Pathology, System } from "./schema";
import type { PathologySummary } from "@/components/atlas/pathology-list";

export function buildViewerModel(system: Entry<System>, locale: string): ViewerModel {
  const source = getSource(system.model.source);
  const species = getSpecies(system.species);
  return {
    systemId: system.id,
    systemName: localeName(system.name, locale),
    speciesName: species ? localeName(species.name, locale) : system.species,
    url: system.model.file,
    color: system.color,
    material: system.material,
    placeholder: system.model.placeholder,
    attribution: { source: source?.name ?? system.model.source, license: source?.license ?? "" },
    regions: system.regions.map((r) => ({ id: r.id, name: localeName(r.name, locale) })),
    structures: getStructuresOfSystem(system.id).map((s) => ({
      id: s.id,
      slug: structureSlug(s),
      title: readDoc(s.dir, locale)?.title ?? s.nav,
      nav: s.nav,
      region: s.region,
      href: structureHref(s),
      meshKeys: s.meshes.map(meshKey),
      color: s.color,
      material: s.material,
      camera: s.camera,
    })),
    systems: loadContent()
      .systems.filter((s) => s.species === system.species)
      .sort((a, b) => a.order - b.order)
      .map((s) => {
        const meshColors: Record<string, string> = {};
        const meshMaterials: Record<string, Material> = {};
        const meshStructure: Record<string, string> = {};
        for (const st of getStructuresOfSystem(s.id)) {
          for (const m of st.meshes) {
            meshStructure[meshKey(m)] = st.id;
            if (st.color) meshColors[meshKey(m)] = st.color;
            if (st.material) meshMaterials[meshKey(m)] = st.material;
          }
        }
        return {
          systemId: s.id,
          slug: s.slug,
          name: localeName(s.name, locale),
          url: s.model.file,
          color: s.color,
          href: systemHref(s),
          order: s.order,
          material: s.material,
          meshColors,
          meshMaterials,
          meshStructure,
        };
      }),
  };
}

export function pathologySummaries(ids: string[], locale: string): PathologySummary[] {
  return ids
    .map((id) => getPathology(id))
    .filter((p): p is Entry<Pathology> => Boolean(p))
    .map((p) => {
      const doc = readDoc(p.dir, locale);
      return { pathology: p, title: doc?.title ?? p.id, summary: doc?.summary ?? "", href: pathologyHref(p) };
    });
}

export { systemHref };
