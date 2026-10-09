"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { ListTreeIcon, XIcon } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { ViewerModel } from "./types";
import { StructureTree } from "./structure-tree";
import { ViewerControls } from "./viewer-controls";
import { DissectionPanel } from "./dissection-panel";
import { OrientationRose, PRESET_KEYS } from "./orientation-rose";
import { useViewerStore } from "./store";
import { useViewUrl } from "./use-view-url";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const Scene = dynamic(() => import("./scene").then((m) => m.Scene), {
  ssr: false,
  loading: () => <SceneLoading />,
});

function SceneLoading() {
  const t = useTranslations("viewer");
  return (
    <div className="grid h-full w-full place-items-center">
      <p className="plate-label">{t("loading")}</p>
    </div>
  );
}

type Props = {
  model: ViewerModel;
  systemHref: string;
  children: ReactNode;
};

function typing(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));
}

// Structure ids are species.system.slug; their page is /species/system/slug.
const hrefOf = (id: string) => `/${id.split(".").join("/")}`;

export function ViewerShell({ model, systemHref, children }: Props) {
  const t = useTranslations("viewer");
  const router = useRouter();
  const pathname = usePathname();
  const [treeOpen, setTreeOpen] = useState(false);
  const setIsolate = useViewerStore((s) => s.setIsolate);
  const clearPreset = useViewerStore((s) => s.clearPreset);
  const activePreset = useViewerStore((s) => s.activePreset);
  const layers = useViewerStore((s) => s.layers);

  useViewUrl(model);

  const selected = useMemo(() => {
    const slug = pathname.startsWith(systemHref + "/") ? pathname.slice(systemHref.length + 1).split("/")[0] : null;
    return model.structures.find((s) => s.slug === slug)?.id ?? null;
  }, [pathname, systemHref, model.structures]);

  // Picks can land on any visible layer: a bone seen through the skin opens
  // that bone's page in the skeletal system, keeping the layers as they are.
  const onPick = useCallback(
    (id: string) => {
      const s = model.structures.find((x) => x.id === id);
      router.push(s ? s.href : hrefOf(id));
    },
    [model.structures, router],
  );

  const onDeselect = useCallback(() => {
    if (selected) router.push(systemHref);
  }, [selected, router, systemHref]);

  const onReset = useCallback(() => useViewerStore.getState().reset(model.systemId, model.systems), [model.systemId, model.systems]);

  // Entering a system for the first time shows it on its own; arriving from
  // another layer keeps the stack, but the studied system is always visible.
  useEffect(() => {
    const store = useViewerStore.getState();
    if (!store.layers[model.systemId]) store.focusSystem(model.systemId, model.systems);
    else if (!store.layers[model.systemId].visible) store.setLayer(model.systemId, { visible: true });
  }, [model.systemId, model.systems]);

  // A new selection frames its own preset; no selection cannot be isolated.
  const firstSelection = useRef(true);
  useEffect(() => {
    if (firstSelection.current) {
      firstSelection.current = false;
      return;
    }
    clearPreset();
    if (!selected) setIsolate(false);
  }, [selected, clearPreset, setIsolate]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const store = useViewerStore.getState();
      const n = Number(e.key);
      if (n >= 1 && n <= 6) store.requestPreset(PRESET_KEYS[n - 1]);
      else if (e.key === "Escape" && selected) onDeselect();
      else if ((e.key === "i" || e.key === "I") && selected) store.setIsolate(!store.isolate);
      else if (e.key === "e" || e.key === "E") store.setExplode(store.explode > 0.01 ? 0 : 0.5);
      else if (e.key === "r" || e.key === "R") onReset();
      else if (e.key === "[" || e.key === "]") {
        const max = model.systems.length - 1;
        const step = e.key === "]" ? 0.5 : -0.5;
        store.peel(Math.min(max, Math.max(0, Math.round((store.depth + step) * 2) / 2)), model.systems);
      } else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, onDeselect, onReset, model.systems]);

  const tree = <StructureTree model={model} selected={selected} onNavigate={() => setTreeOpen(false)} />;
  const attribution = t("attribution", { source: model.attribution.source, license: model.attribution.license });
  const others = model.systems.filter((s) => s.systemId !== model.systemId && layers[s.systemId]?.visible);

  return (
    <main
      id="content"
      className="grid min-h-[calc(100dvh-3.5rem)] grid-rows-[min(62dvh,600px)_auto] lg:h-[calc(100dvh-3.5rem)] lg:grid-cols-[288px_minmax(0,1fr)_minmax(360px,420px)] lg:grid-rows-1"
    >
      <aside className="hidden overflow-y-auto border-r border-border bg-sidebar lg:block" aria-label={t("layers")}>
        <div className="border-b border-border p-4">
          <DissectionPanel model={model} />
        </div>
        {tree}
      </aside>

      <section className="flex min-h-0 flex-col bg-viewer-bg" aria-label={t("sceneLabel")}>
        <div className="relative min-h-0 flex-1">
          <Scene model={model} selected={selected} onPick={onPick} />

          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
            <div className="pointer-events-auto min-w-0">
              <p className="plate-label">
                {model.speciesName} · {model.systemName}
              </p>
              <p className="mt-0.5 font-heading text-[15px] italic text-ink">{activePreset ? t(`preset.${activePreset}`) : t("freeView")}</p>
              {others.length > 0 && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {t("withLayers", { layers: others.map((s) => t(`layerName.${s.material}`).toLowerCase()).join(", ") })}
                </p>
              )}
              <Sheet open={treeOpen} onOpenChange={setTreeOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="lg" className="mt-2 h-11 bg-background lg:hidden">
                    <ListTreeIcon data-icon="inline-start" />
                    {t("layers")} · <span className="tabular">{model.structures.length}</span>
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[320px] gap-0 p-0" showCloseButton={false}>
                  <SheetHeader className="flex-row items-center justify-between border-b border-border py-2 pr-2">
                    <SheetTitle className="font-heading text-base">{t("layers")}</SheetTitle>
                    <SheetClose asChild>
                      <Button variant="ghost" size="icon-lg" aria-label={t("closeList")}>
                        <XIcon />
                      </Button>
                    </SheetClose>
                  </SheetHeader>
                  <div className="min-h-0 flex-1 overflow-y-auto">{tree}</div>
                </SheetContent>
              </Sheet>
              {model.placeholder && <p className="mt-2 max-w-[40ch] text-xs text-muted-foreground">{t("placeholder")}</p>}
            </div>
            <div className="pointer-events-auto hidden lg:block">
              <OrientationRose />
            </div>
          </div>

          <p className="pointer-events-none absolute bottom-2 left-4 right-4 truncate text-[11px] text-muted-foreground" title={attribution}>
            {attribution}
          </p>
        </div>

        <ViewerControls model={model} hasSelection={selected !== null} onReset={onReset} onDeselect={onDeselect} />
      </section>

      <aside className="min-w-0 overflow-y-auto border-t border-border bg-card lg:border-t-0 lg:border-l">{children}</aside>
    </main>
  );
}
