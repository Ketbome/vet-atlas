"use client";
/* eslint-disable react-hooks/immutability -- camera-controls is mutated in place on purpose */

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { CameraControls } from "@react-three/drei";

// Idle sway for the home hero, about ±20° around the lateral view so the plate
// caption stays true. Stops for good once the user grabs the model.
export function Orbit() {
  const controls = useThree((s) => s.controls) as CameraControls | null;
  const paused = useRef(false);

  useEffect(() => {
    if (!controls) return;
    const stop = () => (paused.current = true);
    controls.addEventListener("controlstart", stop);
    return () => controls.removeEventListener("controlstart", stop);
  }, [controls]);

  useFrame(({ clock }) => {
    if (controls && !paused.current) controls.azimuthAngle = -Math.PI / 2 + Math.sin(clock.elapsedTime * 0.3) * 0.35;
  });
  return null;
}

// The hero's canvas can settle (fonts, layout, rotation) after the model framed
// itself, which left the specimen small in a corner: frame again on resize.
export function Refit({ onResize }: { onResize: () => void }) {
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  useEffect(onResize, [width, height, onResize]);
  return null;
}
