"use client";

import { useTranslations } from "next-intl";
import type { CameraPreset } from "@/lib/content/schema";
import { useViewerStore } from "./store";
import { cn } from "@/lib/utils";

// Keyboard order for 1–6; the rose shows them where they point on a lateral
// plate: dorsal up, ventral down, cranial left, caudal right, sides in the middle.
export const PRESET_KEYS: CameraPreset[] = ["lateral-left", "lateral-right", "dorsal", "ventral", "cranial", "caudal"];

// Each label sits on the ring (radius 36 of 100), over a disc of plate ground.
const SLOTS: { preset: CameraPreset; className: string }[] = [
  { preset: "dorsal", className: "left-1/2 top-[14%]" },
  { preset: "ventral", className: "left-1/2 top-[86%]" },
  { preset: "cranial", className: "left-[14%] top-1/2" },
  { preset: "caudal", className: "left-[86%] top-1/2" },
];

export function OrientationRose() {
  const t = useTranslations("viewer");
  const active = useViewerStore((s) => s.activePreset);
  const request = useViewerStore((s) => s.requestPreset);

  const button = (preset: CameraPreset, className?: string) => {
    const on = active === preset;
    return (
      <button
        key={preset}
        type="button"
        onClick={() => request(preset)}
        aria-pressed={on}
        aria-label={t(`preset.${preset}`)}
        title={`${t(`preset.${preset}`)} (${PRESET_KEYS.indexOf(preset) + 1})`}
        className={cn(
          "grid size-9 place-items-center rounded-full font-heading text-[13px] leading-none transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/60",
          on ? "bg-mark font-bold text-[oklch(0.22_0.03_55)]" : "bg-viewer-bg text-ink hover:bg-accent",
          className,
        )}
      >
        {t(`rose.${preset}`)}
      </button>
    );
  };

  return (
    <div role="group" aria-label={t("roseLabel")} className="relative size-[140px] shrink-0">
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full text-ink" aria-hidden="true">
        <circle cx="50" cy="50" r="36" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="0.6" />
        {/* Ticks every 30°, the needles toward the four plate directions. */}
        {Array.from({ length: 12 }, (_, i) => (
          <line key={i} x1="50" y1="12" x2="50" y2="16" stroke="currentColor" strokeOpacity="0.4" strokeWidth="0.6" transform={`rotate(${i * 30} 50 50)`} />
        ))}
        <path d="M50 22 L52.5 47.5 L50 50 L47.5 47.5Z M50 78 L52.5 52.5 L50 50 L47.5 52.5Z" fill="currentColor" fillOpacity="0.6" />
        <path d="M22 50 L47.5 47.5 L50 50 L47.5 52.5Z M78 50 L52.5 47.5 L50 50 L52.5 52.5Z" fill="currentColor" fillOpacity="0.28" />
      </svg>
      {SLOTS.map((s) => button(s.preset, cn("absolute -translate-x-1/2 -translate-y-1/2", s.className)))}
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 gap-0.5 rounded-full border border-rule bg-viewer-bg p-0.5">
        {button("lateral-left", "size-7 text-[11px]")}
        {button("lateral-right", "size-7 text-[11px]")}
      </div>
    </div>
  );
}
