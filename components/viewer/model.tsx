"use client";
/* eslint-disable react-hooks/immutability -- three.js objects are mutated in place on purpose */

import { useEffect, useLayoutEffect, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { Box3, Color, Mesh, type MeshPhysicalMaterial, Vector3, type Object3D } from "three";
import { useViewerStore } from "./store";
import { SKIN_GHOST, setOpacity, setSelected, tissueMaterial } from "./materials";
import type { ViewerSystem } from "./types";

type Props = {
  system: ViewerSystem;
  meshToStructure: Record<string, string>;
  selected: string | null;
  onSceneReady: (scene: Object3D) => void;
  // Piece view: only the selected structure is drawn, in its natural colour.
  solo?: boolean;
};

// Hover warms the tissue slightly toward the ochre mark ink; selection keeps
// the tissue colour and gets an ochre rim light instead.
const MARK = new Color("#C8902E");

// Exploded view pushes each visible mesh away from the centre of the visible
// set, proportionally to its distance, up to EXPLODE times that distance.
const EXPLODE = 1.2;

export function Model({ system, meshToStructure, selected, onSceneReady, solo = false }: Props) {
  const { scene } = useGLTF(system.url);
  const hovered = useViewerStore((s) => s.hovered);
  const isolate = useViewerStore((s) => s.isolate);
  const dim = useViewerStore((s) => s.dim);
  const explode = useViewerStore((s) => s.explode);
  const solidSkin = useViewerStore((s) => s.solidSkin);
  const layer = useViewerStore((s) => s.layers[system.systemId]);

  const meshes = useRef<Mesh[]>([]);

  useLayoutEffect(() => {
    const list: Mesh[] = [];
    scene.updateMatrixWorld(true);
    scene.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      obj.userData.structureId = meshToStructure[obj.name] ?? null;
      const color = system.meshColors[obj.name] ?? system.color;
      const kind = system.meshMaterials[obj.name] ?? system.material;
      obj.material = tissueMaterial(kind, color, obj.geometry.hasAttribute("color"));
      obj.userData.skin = kind === "skin";
      obj.userData.base = new Color(color);
      obj.userData.home ??= obj.position.clone();
      obj.userData.center ??= new Box3().setFromObject(obj).getCenter(new Vector3());
      list.push(obj);
    });
    meshes.current = list;
    onSceneReady(scene);
  }, [scene, system, meshToStructure, onSceneReady]);

  const layerOpacity = solo ? 1 : (layer?.opacity ?? 1);

  useEffect(() => {
    for (const mesh of meshes.current) {
      const id = mesh.userData.structureId as string | null;
      const material = mesh.material as MeshPhysicalMaterial;
      const base = mesh.userData.base as Color;
      const isSelected = id !== null && id === selected;
      const isHovered = id !== null && id === hovered && !isSelected;
      const highlight = isSelected && !solo;
      material.color.copy(base);
      if (isHovered) material.color.lerp(MARK, 0.2);
      setSelected(material, highlight);
      let opacity = Math.min(layerOpacity, !isSelected && selected ? dim : 1);
      if (mesh.userData.skin && !solidSkin && !isSelected && !solo) opacity = Math.min(opacity, SKIN_GHOST);
      setOpacity(material, opacity);
      mesh.visible = solo ? isSelected : !(isolate && selected && !isSelected);
    }
  }, [selected, hovered, isolate, dim, layerOpacity, scene, meshToStructure, solo, solidSkin]);

  useEffect(() => {
    const visible = meshes.current.filter((m) => m.visible);
    const middle = new Vector3();
    for (const m of visible) middle.add(m.userData.center as Vector3);
    if (visible.length) middle.divideScalar(visible.length);
    for (const mesh of meshes.current) {
      const offset = (mesh.userData.center as Vector3).clone().sub(middle).multiplyScalar(explode * EXPLODE);
      mesh.position.copy(mesh.userData.home as Vector3).add(offset);
    }
  }, [explode, selected, isolate, solo, scene]);

  return <primitive object={scene} visible={solo || layer?.visible !== false} />;
}
