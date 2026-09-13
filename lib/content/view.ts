import type { ViewerModel } from "@/components/viewer/types";
import { meshKey } from "./mesh";
import {
  getPathology,
  getSource,
  getStructuresOfSystem,
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
  return {
    systemId: system.id,
    url: system.model.file,
    color: system.color,
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
      camera: s.camera,
    })),
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
