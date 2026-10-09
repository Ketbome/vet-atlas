"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CircleHelpIcon, FocusIcon, LayersIcon, RotateCcwIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { cameraPresets, type CameraPreset } from "@/lib/content/schema";
import type { ViewerModel } from "./types";
import { useViewerStore } from "./store";
import { DissectionPanel } from "./dissection-panel";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Slider } from "@/components/ui/slider";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type Props = {
  model: ViewerModel;
  hasSelection: boolean;
  onReset: () => void;
  onDeselect?: () => void;
  // Piece view: one structure, so no isolate, fading or layers.
  solo?: boolean;
};

function LabelledSlider({ label, value, onChange, min, max, disabled }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; disabled?: boolean }) {
  return (
    <label className="flex shrink-0 items-center gap-2.5 text-xs text-muted-foreground has-[[data-disabled]]:opacity-50">
      <span className="whitespace-nowrap">{label}</span>
      {/* Fixed track width: the slider root is w-full and would collapse in a flex row. */}
      <span className="block w-24 shrink-0">
        <Slider
          min={min}
          max={max}
          step={0.02}
          value={[value]}
          disabled={disabled}
          onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
          aria-label={label}
        />
      </span>
      <span className="tabular w-8 shrink-0 text-right text-foreground">{Math.round(value * 100)}%</span>
    </label>
  );
}

export function ShortcutsHelp() {
  const t = useTranslations("viewer");
  const row = (keys: ReactNode, text: string) => (
    <div className="flex items-center justify-between gap-4 py-1">
      <span>{text}</span>
      <span className="flex gap-1">{keys}</span>
    </div>
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("shortcuts")} title={t("shortcuts")}>
          <CircleHelpIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-80 gap-2 text-xs">
        <p className="plate-label">{t("shortcuts")}</p>
        <p className="text-muted-foreground">{t("hint")}</p>
        <div className="divide-y divide-border">
          {row(<><Kbd>1</Kbd>–<Kbd>6</Kbd></>, t("keyViews"))}
          {row(<><Kbd>[</Kbd><Kbd>]</Kbd></>, t("keyDepth"))}
          {row(<Kbd>I</Kbd>, t("keyIsolate"))}
          {row(<Kbd>E</Kbd>, t("keyExplode"))}
          {row(<Kbd>R</Kbd>, t("keyReset"))}
          {row(<Kbd>Esc</Kbd>, t("keyDeselect"))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// The plate's footer strip: what you do to the specimen, docked under it.
export function ViewerControls({ model, hasSelection, onReset, onDeselect, solo = false }: Props) {
  const t = useTranslations("viewer");
  const isolate = useViewerStore((s) => s.isolate);
  const setIsolate = useViewerStore((s) => s.setIsolate);
  const dim = useViewerStore((s) => s.dim);
  const setDim = useViewerStore((s) => s.setDim);
  const explode = useViewerStore((s) => s.explode);
  const setExplode = useViewerStore((s) => s.setExplode);
  const activePreset = useViewerStore((s) => s.activePreset);
  const requestPreset = useViewerStore((s) => s.requestPreset);

  const isolateToggle = (touch: boolean) => (
    <Toggle
      size={touch ? "lg" : "sm"}
      className={touch ? "h-11" : undefined}
      pressed={isolate}
      onPressedChange={setIsolate}
      disabled={!hasSelection}
      title={hasSelection ? `${t("isolate")} (I)` : t("isolateNeedsSelection")}
    >
      <FocusIcon />
      <span className={touch ? "hidden sm:inline" : undefined}>{t("isolate")}</span>
    </Toggle>
  );

  return (
    <>
      {/* Pointer layouts. */}
      <div className="hidden min-h-12 items-center gap-3 border-t border-border bg-background px-3 lg:flex xl:gap-4">
        {!solo && isolateToggle(false)}
        <LabelledSlider label={t("explodeShort")} value={explode} onChange={setExplode} min={0} max={1} />
        {!solo && <LabelledSlider label={t("dim")} value={dim} onChange={setDim} min={0.1} max={1} disabled={!hasSelection} />}
        <div className="ml-auto flex items-center gap-1">
          <ShortcutsHelp />
          <Button variant="ghost" size="sm" onClick={onReset} title={`${t("reset")} (R)`} aria-label={t("reset")}>
            <RotateCcwIcon data-icon="inline-start" />
            <span className="hidden 2xl:inline">{t("reset")}</span>
          </Button>
          {hasSelection && onDeselect && (
            <Button variant="ghost" size="sm" onClick={onDeselect} title={`${t("deselect")} (Esc)`} aria-label={t("deselect")}>
              <XIcon data-icon="inline-start" />
              <span className="hidden 2xl:inline">{t("deselect")}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Touch layouts: one strip along the bottom edge, inside thumb reach, 44px targets. */}
      <div className="flex items-center gap-1 border-t border-border bg-background px-2 py-1 lg:hidden">
        <select
          value={activePreset ?? ""}
          onChange={(e) => requestPreset(e.target.value as CameraPreset)}
          aria-label={t("presets")}
          className="h-11 min-w-0 flex-1 rounded-md bg-transparent px-2 text-sm font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="" disabled>
            {t("freeView")}
          </option>
          {cameraPresets.map((p) => (
            <option key={p} value={p}>
              {t(`preset.${p}`)}
            </option>
          ))}
        </select>
        {!solo && (
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="lg" className="h-11">
                <LayersIcon data-icon="inline-start" />
                {t("dissection")}
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[80dvh] gap-0 overflow-y-auto p-4">
              <SheetHeader className="sr-only p-0">
                <SheetTitle>{t("dissection")}</SheetTitle>
              </SheetHeader>
              <DissectionPanel model={model} />
            </SheetContent>
          </Sheet>
        )}
        {!solo && isolateToggle(true)}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-lg" className="size-11" aria-label={t("settings")}>
              <SlidersHorizontalIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-[min(18rem,calc(100vw-2rem))]">
            <LabelledSlider label={t("explodeShort")} value={explode} onChange={setExplode} min={0} max={1} />
            {!solo && <LabelledSlider label={t("dim")} value={dim} onChange={setDim} min={0.1} max={1} disabled={!hasSelection} />}
          </PopoverContent>
        </Popover>
        <Button variant="ghost" size="icon-lg" className="size-11" onClick={onReset} aria-label={t("reset")}>
          <RotateCcwIcon />
        </Button>
        {hasSelection && onDeselect && (
          <Button variant="ghost" size="icon-lg" className="size-11" onClick={onDeselect} aria-label={t("deselect")}>
            <XIcon />
          </Button>
        )}
      </div>
    </>
  );
}
