import type { CameraPreset, materials } from "@/lib/content/schema";

export type Material = (typeof materials)[number];

export type ViewerStructure = {
  id: string;
  slug: string;
  title: string;
  nav: string;
  region: string;
  href: string;
  meshKeys: string[];
  color?: string;
  material?: Material;
  camera: { preset: CameraPreset; zoom: number };
};

export type ViewerRegion = { id: string; name: string };

// One system of the species, as a layer of the dissection stack. The system
// being studied is pickable; the others are drawn as context.
export type ViewerSystem = {
  systemId: string;
  slug: string;
  name: string;
  url: string;
  color: string;
  href: string;
  order: number;
  material: Material;
  // Colour and finish overrides per GLB mesh name.
  meshColors: Record<string, string>;
  meshMaterials: Record<string, Material>;
  // GLB mesh name -> structure id, so any visible layer can be picked.
  meshStructure: Record<string, string>;
};

export type ViewerModel = {
  systemId: string;
  systemName: string;
  speciesName: string;
  url: string;
  color: string;
  material: Material;
  placeholder: boolean;
  attribution: { source: string; license: string };
  regions: ViewerRegion[];
  structures: ViewerStructure[];
  // Every system of the species, superficial to deep, including this one.
  systems: ViewerSystem[];
};
