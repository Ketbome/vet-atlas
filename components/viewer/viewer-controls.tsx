"use client";

import { useTranslations } from "next-intl";
import { FocusIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { cameraPresets } from "@/lib/content/schema";
import { useViewerStore } from "./store";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ViewerControls({ hasSelection, onDeselect }: { hasSelection: boolean; onDeselect: () => void }) {
  const t = useTranslations("viewer");
  const isolate = useViewerStore((s) => s.isolate);
  const setIsolate = useViewerStore((s) => s.setIsolate);
  const opacity = useViewerStore((s) => s.opacity);
  const setOpacity = useViewerStore((s) => s.setOpacity);
  const requestPreset = useViewerStore((s) => s.requestPreset);
  const reset = useViewerStore((s) => s.reset);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex max-w-[calc(100vw-5rem)] items-center gap-1 overflow-x-auto rounded-lg border border-border bg-card/90 p-1 shadow-sm backdrop-blur lg:max-w-none">
        {cameraPresets.map((p) => (
          <Button key={p} variant="ghost" size="xs" onClick={() => requestPreset(p)} className="shrink-0 text-muted-foreground hover:text-foreground">
            {t(`preset.${p}`)}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card/90 p-1 shadow-sm backdrop-blur">
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle size="sm" pressed={isolate} onPressedChange={setIsolate} disabled={!hasSelection} aria-label={t("isolate")}>
              <FocusIcon />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>{isolate ? t("showAll") : t("isolate")}</TooltipContent>
        </Tooltip>
        <div className="flex w-28 items-center gap-2 px-2" title={t("opacity")}>
          <Slider
            id="viewer-opacity"
            min={0.1}
            max={1}
            step={0.05}
            value={[opacity]}
            onValueChange={(v) => setOpacity(Array.isArray(v) ? v[0] : v)}
            aria-label={t("opacity")}
          />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={reset} aria-label={t("reset")}>
              <RotateCcwIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("reset")}</TooltipContent>
        </Tooltip>
        {hasSelection && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onDeselect} aria-label={t("deselect")}>
                <XIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("deselect")}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
