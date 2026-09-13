"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bvh, CameraControls, Html } from "@react-three/drei";
import { Box3, Vector3, type Object3D } from "three";
import { useTranslations } from "next-intl";
import type { ViewerModel } from "./types";
import { Model } from "./model";
import { useViewerStore } from "./store";
import { presetAngles } from "./camera";

type Props = {
  model: ViewerModel;
  selected: string | null;
  onSelect: (structureId: string) => void;
  onDeselect: () => void;
};

export function Scene({ model, selected, onSelect, onDeselect }: Props) {
  const t = useTranslations("viewer");
  const controls = useRef<CameraControls>(null);
  const [scene, setScene] = useState<Object3D | null>(null);
  const presetRequest = useViewerStore((s) => s.presetRequest);
  const resetNonce = useViewerStore((s) => s.resetNonce);

  const meshToStructure = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of model.structures) for (const key of s.meshKeys) map[key] = s.id;
    return map;
  }, [model.structures]);

  const onSceneReady = useCallback((obj: Object3D) => setScene(obj), []);

  const frame = useCallback(
    (structureId: string | null, animate: boolean) => {
      const c = controls.current;
      if (!c || !scene) return;
      const structure = structureId ? model.structures.find((s) => s.id === structureId) : null;
      const box = new Box3();
      if (structure) {
        const keys = new Set(structure.meshKeys);
        scene.traverse((o) => {
          if (keys.has(o.name)) box.expandByObject(o);
        });
      }
      if (box.isEmpty()) box.setFromObject(scene);

      const preset = structure?.camera.preset ?? "lateral-left";
      const { azimuth, polar } = presetAngles[preset];
      const size = box.getSize(new Vector3()).length();
      const padding = structure ? size * (1.4 / structure.camera.zoom) : size * 0.35;
      c.rotateTo(azimuth, polar, animate);
      c.fitToBox(box, animate, { paddingTop: padding, paddingBottom: padding, paddingLeft: padding, paddingRight: padding });
    },
    [scene, model.structures],
  );

  useEffect(() => {
    frame(selected, true);
  }, [selected, frame]);

  useEffect(() => {
    if (resetNonce > 0) frame(selected, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);

  useEffect(() => {
    if (!presetRequest || !controls.current) return;
    const { azimuth, polar } = presetAngles[presetRequest.preset];
    controls.current.rotateTo(azimuth, polar, true);
  }, [presetRequest]);

  return (
    <Canvas
      camera={{ position: [-1.2, 0.5, 0.2], fov: 35, near: 0.01, far: 50 }}
      dpr={[1, 2]}
      onPointerMissed={() => onDeselect()}
      className="touch-none"
      fallback={<div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">{t("noWebgl")}</div>}
    >
      <color attach="background" args={["#00000000"]} />
      <hemisphereLight args={["#ffffff", "#8a8578", 0.9]} />
      <directionalLight position={[2, 3, 2]} intensity={1.6} />
      <directionalLight position={[-2, 1, -1]} intensity={0.6} />
      <Suspense
        fallback={
          <Html center>
            <div className="rounded-md bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">{t("loading")}</div>
          </Html>
        }
      >
        <Bvh firstHitOnly>
          <Model
            url={model.url}
            color={model.color}
            meshToStructure={meshToStructure}
            selected={selected}
            onSelect={onSelect}
            onSceneReady={onSceneReady}
          />
        </Bvh>
      </Suspense>
      <CameraControls ref={controls} makeDefault minDistance={0.05} maxDistance={8} smoothTime={0.35} dollyToCursor />
    </Canvas>
  );
}
