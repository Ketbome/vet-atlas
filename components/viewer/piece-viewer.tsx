"use client";

import { useCallback } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { ArrowLeftIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { ViewerModel } from "./types";
import { ViewerControls } from "./viewer-controls";
import { OrientationRose } from "./orientation-rose";
import { useViewerStore } from "./store";
import { Button } from "@/components/ui/button";

const Scene = dynamic(() => import("./scene").then((m) => m.Scene), { ssr: false });

const noop = () => {};

type Props = { model: ViewerModel; structureId: string; title: string; nav: string; backHref: string };

// One structure alone, as a full plate, to turn it around and explode its parts.
export function PieceViewer({ model, structureId, title, nav, backHref }: Props) {
  const t = useTranslations("viewer");
  const activePreset = useViewerStore((s) => s.activePreset);
  const attribution = t("attribution", { source: model.attribution.source, license: model.attribution.license });
  const onReset = useCallback(() => useViewerStore.getState().reset(model.systemId, model.systems), [model.systemId, model.systems]);

  return (
    <main id="content" className="flex h-[calc(100dvh-3.5rem)] flex-col bg-viewer-bg">
      <div className="relative min-h-0 flex-1">
        <Scene model={model} selected={structureId} onPick={noop} solo />

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
          <div className="pointer-events-auto flex min-w-0 items-start gap-3">
            <Button asChild variant="outline" size="icon-lg" className="size-11 shrink-0 bg-background">
              <Link href={backHref} aria-label={t("pieceBack")}>
                <ArrowLeftIcon />
              </Link>
            </Button>
            <div className="min-w-0">
              <p className="plate-label">
                {model.speciesName} · {model.systemName}
              </p>
              <h1 className="truncate font-display text-[28px] leading-tight text-ink">{title}</h1>
              <p lang="la" className="nav-latin truncate text-base text-ink/80">
                {nav}
              </p>
              <p className="mt-1 font-heading text-[13px] italic text-muted-foreground">{activePreset ? t(`preset.${activePreset}`) : t("freeView")}</p>
            </div>
          </div>
          <div className="pointer-events-auto hidden lg:block">
            <OrientationRose />
          </div>
        </div>

        <p className="pointer-events-none absolute bottom-2 left-4 right-4 truncate text-[11px] text-muted-foreground" title={attribution}>
          {t("pieceHint")} · {attribution}
        </p>
      </div>
      <ViewerControls model={model} hasSelection onReset={onReset} solo />
    </main>
  );
}
