import { create } from "zustand";
import type { CameraPreset } from "@/lib/content/schema";

export type StructureTab = "description" | "pathologies" | "media";

export type LayerState = { visible: boolean; opacity: number };
export const HIDDEN_LAYER: LayerState = { visible: false, opacity: 1 };

type ViewerState = {
  hovered: string | null;
  isolate: boolean;
  // Opacity of the structures around the selected one, in the system studied.
  dim: number;
  explode: number;
  // Short-coat fur on the skin layer (shell rendering).
  fur: boolean;
  // Per system id. The system being studied is always visible.
  layers: Record<string, LayerState>;
  // Dissection depth, 0 = skin; layers above it fade out (see peel()).
  depth: number;
  activePreset: CameraPreset | null;
  presetRequest: { preset: CameraPreset; nonce: number } | null;
  resetNonce: number;
  tab: StructureTab;
  setHovered: (id: string | null) => void;
  setIsolate: (v: boolean) => void;
  setDim: (v: number) => void;
  setExplode: (v: number) => void;
  setFur: (v: boolean) => void;
  setLayer: (systemId: string, patch: Partial<LayerState>) => void;
  peel: (depth: number, systems: { systemId: string; order: number }[]) => void;
  focusSystem: (systemId: string, systems: { systemId: string; order: number }[]) => void;
  requestPreset: (preset: CameraPreset) => void;
  clearPreset: () => void;
  setTab: (tab: StructureTab) => void;
  reset: (systemId: string, systems: { systemId: string; order: number }[]) => void;
};

// Layers shallower than `depth` fade out over one step; deeper ones show.
function peeled(depth: number, systems: { systemId: string; order: number }[]) {
  const layers: Record<string, LayerState> = {};
  for (const s of systems) {
    const opacity = Math.min(1, Math.max(0, s.order + 1 - depth));
    layers[s.systemId] = { visible: opacity > 0.02, opacity: Math.max(opacity, 0.02) };
  }
  return layers;
}

export const useViewerStore = create<ViewerState>((set) => ({
  hovered: null,
  isolate: false,
  // The rest fades by default when a piece is selected, so a buried
  // structure (the heart inside the lungs) is always seen.
  dim: 0.3,
  explode: 0,
  fur: true,
  layers: {},
  depth: 0,
  activePreset: null,
  presetRequest: null,
  resetNonce: 0,
  tab: "description",
  setHovered: (hovered) => set({ hovered }),
  setIsolate: (isolate) => set({ isolate }),
  setDim: (dim) => set({ dim }),
  setExplode: (explode) => set({ explode }),
  setFur: (fur) => set({ fur }),
  setLayer: (systemId, patch) =>
    set((s) => ({ layers: { ...s.layers, [systemId]: { ...HIDDEN_LAYER, ...s.layers[systemId], ...patch } } })),
  peel: (depth, systems) => set({ depth, layers: peeled(depth, systems) }),
  // Studying a system: it shows solid, nothing deeper, nothing covering it.
  focusSystem: (systemId, systems) => {
    const order = systems.find((s) => s.systemId === systemId)?.order ?? 0;
    const layers: Record<string, LayerState> = {};
    for (const s of systems) layers[s.systemId] = s.systemId === systemId ? { visible: true, opacity: 1 } : HIDDEN_LAYER;
    set({ layers, depth: order });
  },
  requestPreset: (preset) =>
    set((s) => ({ activePreset: preset, presetRequest: { preset, nonce: (s.presetRequest?.nonce ?? 0) + 1 } })),
  clearPreset: () => set({ activePreset: null }),
  setTab: (tab) => set({ tab }),
  reset: (systemId, systems) => {
    const order = systems.find((s) => s.systemId === systemId)?.order ?? 0;
    const layers: Record<string, LayerState> = {};
    for (const s of systems) layers[s.systemId] = s.systemId === systemId ? { visible: true, opacity: 1 } : HIDDEN_LAYER;
    set((s) => ({ isolate: false, dim: 0.3, explode: 0, layers, depth: order, activePreset: null, resetNonce: s.resetNonce + 1 }));
  },
}));
