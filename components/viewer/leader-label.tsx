"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Box3, Mesh, Vector3, type Group, type Object3D } from "three";

type Props = { scene: Object3D; meshKeys: string[]; title: string; nav: string };

const box = new Box3();

// The surface point nearest the top centre of the meshes, so the leader
// lands on tissue even for paired or curved structures (eyes, kidneys).
function surfaceAnchor(meshes: Object3D[]) {
  box.makeEmpty();
  for (const m of meshes) box.expandByObject(m);
  const target = box.getCenter(new Vector3()).setY(box.max.y);
  const v = new Vector3();
  let best: { mesh: Object3D; point: Vector3 } | null = null;
  let min = Infinity;
  for (const m of meshes) {
    if (!(m instanceof Mesh)) continue;
    const position = m.geometry.getAttribute("position");
    const step = Math.max(1, Math.floor(position.count / 4000));
    for (let i = 0; i < position.count; i += step) {
      v.fromBufferAttribute(position, i);
      const d = v.clone().applyMatrix4(m.matrixWorld).distanceToSquared(target);
      if (d < min) {
        min = d;
        best = { mesh: m, point: v.clone() };
      }
    }
  }
  return best;
}

// Atlas-plate label: a hairline leader from the top of the structure to its
// name, the Latin NAV term beneath in italic. Text carries a paper halo
// instead of a box. Follows the meshes when they move (exploded view).
export function LeaderLabel({ scene, meshKeys, title, nav }: Props) {
  const group = useRef<Group>(null);
  const parts = useMemo(() => {
    const keys = new Set(meshKeys);
    const list: Object3D[] = [];
    scene.traverse((o) => {
      if (keys.has(o.name)) list.push(o);
    });
    scene.updateMatrixWorld(true);
    return { list, anchor: surfaceAnchor(list) };
  }, [scene, meshKeys]);

  useFrame(() => {
    if (!group.current) return;
    const { list, anchor } = parts;
    group.current.visible = list.some((m) => m.visible);
    if (anchor) group.current.position.copy(anchor.point).applyMatrix4(anchor.mesh.matrixWorld);
  });

  return (
    <group ref={group}>
      <Html zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div className="relative -translate-y-full select-none">
          <svg width="56" height="44" viewBox="0 0 56 44" className="absolute bottom-0 left-0 overflow-visible text-ink" aria-hidden="true">
            <circle cx="0" cy="44" r="2.5" className="fill-mark" />
            <path d="M0 44 L28 8 L56 8" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
          <div className="absolute bottom-[34px] left-[60px] whitespace-nowrap rounded-[2px] bg-viewer-bg/90 px-1.5 py-0.5">
            <p className="text-sm font-semibold leading-tight text-ink">{title}</p>
            <p lang="la" className="nav-latin text-[13px] leading-tight text-ink">
              {nav}
            </p>
          </div>
        </div>
      </Html>
    </group>
  );
}
