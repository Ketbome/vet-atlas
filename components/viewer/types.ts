import type { CameraPreset } from "@/lib/content/schema";

export type ViewerStructure = {
  id: string;
  slug: string;
  title: string;
  nav: string;
  region: string;
  href: string;
  meshKeys: string[];
  camera: { preset: CameraPreset; zoom: number };
};

export type ViewerRegion = { id: string; name: string };

export type ViewerModel = {
  systemId: string;
  url: string;
  color: string;
  placeholder: boolean;
  attribution: { source: string; license: string };
  regions: ViewerRegion[];
  structures: ViewerStructure[];
};
