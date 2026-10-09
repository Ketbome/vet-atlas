"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Box3, type Group, type Object3D } from "three";

type Props = { scene: Object3D; meshKeys: string[]; title: string; nav: string };

const box = new Box3();

// Atlas-plate label: a hairline leader from the top of the structure to its
// name, the Latin NAV term beneath in italic. Text carries a paper halo
// instead of a box. Follows the meshes when they move (exploded view).
export function LeaderLabel({ scene, meshKeys, title, nav }: Props) {
  const group = useRef<Group>(null);
  const meshes = useMemo(() => {
    const keys = new Set(meshKeys);
    const list: Object3D[] = [];
    scene.traverse((o) => {
      if (keys.has(o.name)) list.push(o);
    });
    return list;
  }, [scene, meshKeys]);

  useFrame(() => {
    if (!group.current) return;
    box.makeEmpty();
    for (const m of meshes) if (m.visible) box.expandByObject(m);
    group.current.visible = !box.isEmpty();
    if (!box.isEmpty()) box.getCenter(group.current.position).setY(box.max.y);
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
