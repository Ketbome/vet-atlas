"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { Bvh, CameraControls, ContactShadows, Environment, Html, Lightformer } from "@react-three/drei";
import { Box3, type Mesh, type MeshPhysicalMaterial, NeutralToneMapping, Vector3, type Object3D } from "three";
import { useTranslations } from "next-intl";
import { RotateCcwIcon } from "lucide-react";
import type { ViewerModel } from "./types";
import { Model } from "./model";
import { LayerModel } from "./layer-model";
import { LeaderLabel } from "./leader-label";
import { useViewerStore } from "./store";
import { presetAngles } from "./camera";
import { SceneBoundary } from "./scene-boundary";
import { Orbit } from "./orbit";
import { useMediaQuery } from "@/lib/use-media-query";
import { Button } from "@/components/ui/button";

type Props = {
  model: ViewerModel;
  selected: string | null;
  // Any structure of any visible layer; the shell decides where it leads.
  onPick: (structureId: string) => void;
  // Home hero: slow orbit, no framing on selection, hover and click still work.
  orbit?: boolean;
  // Piece view: only the selected structure, no other layers, no label.
  solo?: boolean;
};

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

// The nearest visible hit. A see-through context layer (skin at 30%) lets the
// click through to what is behind; faded pieces of the studied system don't.
function pickedStructure(e: ThreeEvent<PointerEvent | MouseEvent>) {
  for (const hit of e.intersections) {
    const mesh = hit.object as Mesh;
    let visible = true;
    for (let o: Object3D | null = mesh; o; o = o.parent) if (!o.visible) visible = false;
    const id = mesh.userData.structureId as string | null | undefined;
    if (!visible || !id) continue;
    if (mesh.userData.layer && (mesh.material as MeshPhysicalMaterial).opacity < 0.5) continue;
    return id;
  }
  return null;
}

export function Scene({ model, selected, onPick, orbit = false, solo = false }: Props) {
  const t = useTranslations("viewer");
  const controls = useRef<CameraControls>(null);
  const [scene, setScene] = useState<Object3D | null>(null);
  const presetRequest = useViewerStore((s) => s.presetRequest);
  const resetNonce = useViewerStore((s) => s.resetNonce);
  const layers = useViewerStore((s) => s.layers);
  const setHovered = useViewerStore((s) => s.setHovered);
  const clearPreset = useViewerStore((s) => s.clearPreset);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [webgl] = useState(hasWebGL);

  const active = model.systems.find((s) => s.systemId === model.systemId)!;

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
      // Metres around the box: proportional for large pieces, with a floor so
      // a small bone keeps a little of its neighbours in view.
      const padding = structure ? Math.max(0.035, (size * 0.25) / structure.camera.zoom) : size * 0.06;
      c.rotateTo(azimuth, polar, animate);
      c.fitToBox(box, animate, { paddingTop: padding, paddingBottom: padding, paddingLeft: padding, paddingRight: padding });
    },
    [scene, model.structures],
  );

  useEffect(() => {
    frame(orbit ? null : selected, !reducedMotion);
    // A named view from the URL (or picked before the model loaded) wins.
    const preset = useViewerStore.getState().activePreset;
    if (preset && !orbit) {
      const { azimuth, polar } = presetAngles[preset];
      controls.current?.rotateTo(azimuth, polar, !reducedMotion);
    }
  }, [selected, frame, orbit, reducedMotion]);

  useEffect(() => {
    if (resetNonce > 0) frame(selected, !reducedMotion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);

  useEffect(() => {
    if (!presetRequest || !controls.current) return;
    const { azimuth, polar } = presetAngles[presetRequest.preset];
    controls.current.rotateTo(azimuth, polar, !reducedMotion);
  }, [presetRequest, reducedMotion]);

  // A hand orbit leaves the named view: the rose stops claiming it.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.addEventListener("controlstart", clearPreset);
    return () => c.removeEventListener("controlstart", clearPreset);
  }, [clearPreset, webgl]);

  const labelled = !solo && !orbit && selected ? model.structures.find((s) => s.id === selected) : undefined;

  const notice = (children: React.ReactNode) => (
    <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">{children}</div>
  );

  if (!webgl) return notice(t("noWebgl"));

  return (
    <SceneBoundary
      fallback={(retry) =>
        notice(
          <div className="flex flex-col items-center gap-3">
            <p className="max-w-[36ch]">{t("loadError")}</p>
            <Button variant="outline" size="sm" onClick={retry}>
              <RotateCcwIcon data-icon="inline-start" />
              {t("retry")}
            </Button>
          </div>,
        )
      }
    >
      <Canvas
        camera={{ position: [-1.2, 0.5, 0.2], fov: 32, near: 0.01, far: 50 }}
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true, toneMapping: NeutralToneMapping }}
        className="touch-none"
        fallback={notice(t("noWebgl"))}
      >
        {/* Dissection-room light built in-scene (no HDR download, works
            offline): a large overhead softbox, a dim warm fill and a floor
            bounce. Broad and low-contrast, so tissue reads by its colour and
            the baked occlusion rather than by glints. */}
        <Environment resolution={128} frames={1} environmentIntensity={0.55}>
          <Lightformer form="rect" intensity={1.6} position={[0, 4, 1]} scale={[8, 6, 1]} target={[0, 0, 0]} />
          <Lightformer form="rect" intensity={0.5} color="#fff1e2" position={[3, 1, 2]} scale={[4, 4, 1]} target={[0, 0.3, 0]} />
          <Lightformer form="rect" intensity={0.4} color="#e8eef8" position={[-3, 1, -2]} scale={[4, 4, 1]} target={[0, 0.3, 0]} />
          <Lightformer form="circle" intensity={0.35} color="#efe6da" position={[0, -2, 0]} scale={5} target={[0, 0, 0]} />
        </Environment>
        <hemisphereLight args={["#fbf7f0", "#6f675d", 0.55]} />
        <directionalLight position={[-1.2, 3, 1.6]} intensity={0.9} />
        <Suspense
          fallback={
            <Html center>
              <div className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">{t("loading")}</div>
            </Html>
          }
        >
          <Bvh firstHitOnly>
            <group
              onPointerMove={(e) => {
                e.stopPropagation();
                setHovered(pickedStructure(e));
              }}
              onPointerOut={() => setHovered(null)}
              onClick={(e) => {
                e.stopPropagation();
                const id = pickedStructure(e);
                if (id) onPick(id);
              }}
            >
              <Model system={active} meshToStructure={meshToStructure} selected={selected} onSceneReady={onSceneReady} solo={solo} />
              {!solo &&
                !orbit &&
                model.systems.map((s) =>
                  s.systemId !== model.systemId && layers[s.systemId]?.visible ? (
                    <Suspense key={s.systemId} fallback={null}>
                      <LayerModel system={s} opacity={layers[s.systemId].opacity} />
                    </Suspense>
                  ) : null,
                )}
            </group>
          </Bvh>
          {labelled && scene && <LeaderLabel scene={scene} meshKeys={labelled.meshKeys} title={labelled.title} nav={labelled.nav} />}
        </Suspense>
        {!solo && <ContactShadows position={[0, 0.0005, 0]} opacity={0.38} scale={2.4} blur={2.4} far={0.8} resolution={512} />}
        <CameraControls ref={controls} makeDefault minDistance={0.05} maxDistance={8} smoothTime={0.35} dollyToCursor />
        {orbit && !reducedMotion && <Orbit />}
      </Canvas>
    </SceneBoundary>
  );
}
