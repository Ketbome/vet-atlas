"use client";
/* eslint-disable react-hooks/immutability -- three.js objects are mutated in place on purpose */

import { useEffect, useLayoutEffect, useRef } from "react";
import { useGLTF, useCursor } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { Color, Mesh, MeshStandardMaterial, type Object3D } from "three";
import { useViewerStore } from "./store";

type Props = {
  url: string;
  color: string;
  meshToStructure: Record<string, string>;
  selected: string | null;
  onSelect: (structureId: string) => void;
  onSceneReady: (scene: Object3D) => void;
};

const SELECTED = new Color("#6A5DC7");
const HOVERED = new Color("#B4ABE6");
const GLOW = new Color("#4B3F8F");
const NONE = new Color("#000000");

export function Model({ url, color, meshToStructure, selected, onSelect, onSceneReady }: Props) {
  const { scene } = useGLTF(url);
  const hovered = useViewerStore((s) => s.hovered);
  const isolate = useViewerStore((s) => s.isolate);
  const opacity = useViewerStore((s) => s.opacity);
  const setHovered = useViewerStore((s) => s.setHovered);

  const meshes = useRef<Mesh[]>([]);

  useLayoutEffect(() => {
    const list: Mesh[] = [];
    const base = new Color(color);
    scene.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      obj.userData.structureId = meshToStructure[obj.name] ?? null;
      obj.material = new MeshStandardMaterial({ color: base, roughness: 0.8, metalness: 0 });
      list.push(obj);
    });
    meshes.current = list;
    onSceneReady(scene);
  }, [scene, color, meshToStructure, onSceneReady]);

  useEffect(() => {
    const base = new Color(color);
    for (const mesh of meshes.current) {
      const id = mesh.userData.structureId as string | null;
      const material = mesh.material as MeshStandardMaterial;
      const isSelected = id !== null && id === selected;
      const isHovered = id !== null && id === hovered && !isSelected;
      material.color.copy(isSelected ? SELECTED : isHovered ? HOVERED : base);
      material.emissive.copy(isSelected ? GLOW : NONE);
      material.emissiveIntensity = isSelected ? 0.25 : 0;
      const dim = !isSelected && opacity < 1;
      material.transparent = dim;
      material.opacity = dim ? opacity : 1;
      material.depthWrite = !dim;
      material.needsUpdate = true;
      mesh.visible = !(isolate && selected && !isSelected);
    }
  }, [selected, hovered, isolate, opacity, color, scene, meshToStructure]);

  useCursor(hovered !== null);

  function structureOf(e: ThreeEvent<PointerEvent | MouseEvent>) {
    const hit = e.intersections.find((i) => i.object.visible);
    return (hit?.object.userData.structureId as string | null) ?? null;
  }

  return (
    <primitive
      object={scene}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        setHovered(structureOf(e));
      }}
      onPointerOut={() => setHovered(null)}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        const id = structureOf(e);
        if (id) onSelect(id);
      }}
    />
  );
}
