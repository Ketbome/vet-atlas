import type { CameraPreset } from "@/lib/content/schema";

// camera-controls angles: azimuth 0 = camera on +Z, polar 0 = above (Y up).
// Model convention: animal faces -Z, its left side is -X.
export const presetAngles: Record<CameraPreset, { azimuth: number; polar: number }> = {
  "lateral-left": { azimuth: -Math.PI / 2, polar: Math.PI / 2 },
  "lateral-right": { azimuth: Math.PI / 2, polar: Math.PI / 2 },
  dorsal: { azimuth: -Math.PI / 2, polar: 0.001 },
  ventral: { azimuth: -Math.PI / 2, polar: Math.PI - 0.001 },
  cranial: { azimuth: Math.PI, polar: Math.PI / 2 },
  caudal: { azimuth: 0, polar: Math.PI / 2 },
};
