import { create } from "zustand";
import type { CameraPreset } from "@/lib/content/schema";

type ViewerState = {
  hovered: string | null;
  isolate: boolean;
  opacity: number;
  presetRequest: { preset: CameraPreset; nonce: number } | null;
  resetNonce: number;
  setHovered: (id: string | null) => void;
  setIsolate: (v: boolean) => void;
  setOpacity: (v: number) => void;
  requestPreset: (preset: CameraPreset) => void;
  reset: () => void;
};

export const useViewerStore = create<ViewerState>((set) => ({
  hovered: null,
  isolate: false,
  opacity: 1,
  presetRequest: null,
  resetNonce: 0,
  setHovered: (hovered) => set({ hovered }),
  setIsolate: (isolate) => set({ isolate }),
  setOpacity: (opacity) => set({ opacity }),
  requestPreset: (preset) => set((s) => ({ presetRequest: { preset, nonce: (s.presetRequest?.nonce ?? 0) + 1 } })),
  reset: () => set((s) => ({ isolate: false, opacity: 1, resetNonce: s.resetNonce + 1 })),
}));
