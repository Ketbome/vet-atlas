"use client";

import { useEffect, useLayoutEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { Color, Mesh, type MeshPhysicalMaterial } from "three";
import { useViewerStore } from "./store";
import { setOpacity, tissueMaterial } from "./materials";
import { syncFur } from "./fur";
import type { ViewerSystem } from "./types";

type Props = { system: ViewerSystem; opacity: number };

// A layer of the dissection stack that is not being studied: real colours,
// optionally see-through. Picking is handled by the scene for all layers.
const MARK = new Color("#C8902E");
export function LayerModel({ system, opacity }: Props) {
  const { scene } = useGLTF(system.url);
  // A clone, so the cached scene stays untouched for that system's own viewer.
  // Clone and materials are made together: React may run this twice (strict
  // mode) and must keep a pair whose meshes really use these materials.
  const { clone, materials } = useMemo(() => {
    const clone = scene.clone();
    const materials: MeshPhysicalMaterial[] = [];
    // The cached scene may carry fur shells from the studied view; a layer
    // builds its own.
    const stale: Mesh[] = [];
    clone.traverse((obj) => {
      if (obj instanceof Mesh && obj.userData.furShell) stale.push(obj);
    });
    for (const s of stale) s.removeFromParent();
    clone.traverse((obj) => {
      if (!(obj instanceof Mesh) || obj.userData.furShell) return;
      delete obj.userData.fur;
      const kind = system.meshMaterials[obj.name] ?? system.material;
      const material = tissueMaterial(kind, system.meshColors[obj.name] ?? system.color, obj.geometry.hasAttribute("color"));
      obj.userData.skin = kind === "skin";
      obj.material = material;
      obj.userData.structureId = system.meshStructure[obj.name] ?? null;
      obj.userData.layer = true;
      obj.userData.base = material.color.clone();
      obj.renderOrder = 1;
      materials.push(material);
    });
    return { clone, materials };
  }, [scene, system]);

  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);

  const hovered = useViewerStore((s) => s.hovered);
  const fur = useViewerStore((s) => s.fur);
  useEffect(() => {
    clone.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      const material = obj.material as MeshPhysicalMaterial;
      material.color.copy(obj.userData.base as Color);
      if (hovered && obj.userData.structureId === hovered) material.color.lerp(MARK, 0.18);
      if (obj.userData.skin) syncFur(obj, fur && opacity >= 1);
    });
  }, [clone, hovered, fur, opacity]);

  useLayoutEffect(() => {
    for (const material of materials) setOpacity(material, opacity);
    clone.traverse((obj) => {
      if (obj instanceof Mesh && obj.userData.skin) syncFur(obj, fur && opacity >= 1);
    });
  }, [materials, opacity, clone, fur]);

  return <primitive object={clone} />;
}
