"use client";

import { useEffect } from "react";
import { cameraPresets, type CameraPreset } from "@/lib/content/schema";
import type { ViewerModel } from "./types";
import { useViewerStore } from "./store";

// Mirrors what is on screen into the query string, so a view can be shared:
//   ?v=dorsal&x=40&l=integumentary:30,skeletal:100&i=1
// v = named view, x = explode %, l = visible layers with opacity %, i = isolate.
// The path already carries the system and the selected structure.
export function useViewUrl(model: ViewerModel) {
  useEffect(() => {
    const store = useViewerStore.getState();
    const q = new URLSearchParams(window.location.search);
    const bySlug = new Map(model.systems.map((s) => [s.slug, s.systemId]));

    const layers = q.get("l");
    if (layers) {
      for (const s of model.systems) store.setLayer(s.systemId, { visible: false });
      for (const part of layers.split(",")) {
        const [slug, pct] = part.split(":");
        const id = bySlug.get(slug);
        if (id) store.setLayer(id, { visible: true, opacity: Math.min(1, Math.max(0.05, Number(pct ?? 100) / 100)) });
      }
    }
    const x = Number(q.get("x"));
    if (x > 0) store.setExplode(Math.min(1, x / 100));
    if (q.get("i") === "1") store.setIsolate(true);
    const v = q.get("v");
    if (v && (cameraPresets as readonly string[]).includes(v)) store.requestPreset(v as CameraPreset);
    // Only on entering the viewer; later changes flow the other way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useViewerStore.subscribe((s) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const q = new URLSearchParams();
        if (s.activePreset) q.set("v", s.activePreset);
        if (s.explode > 0.01) q.set("x", String(Math.round(s.explode * 100)));
        const visible = model.systems
          .filter((x) => (x.systemId === model.systemId ? s.layers[x.systemId]?.visible !== false : s.layers[x.systemId]?.visible))
          .map((x) => `${x.slug}:${Math.round((s.layers[x.systemId]?.opacity ?? 1) * 100)}`);
        const onlyActive = visible.length === 1 && visible[0] === `${model.systems.find((x) => x.systemId === model.systemId)!.slug}:100`;
        if (!onlyActive) q.set("l", visible.join(","));
        if (s.isolate) q.set("i", "1");
        const search = q.toString();
        const url = window.location.pathname + (search ? `?${search}` : "") + window.location.hash;
        if (url !== window.location.pathname + window.location.search + window.location.hash) window.history.replaceState(window.history.state, "", url);
      }, 250);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [model.systems, model.systemId]);
}
