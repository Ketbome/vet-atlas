"use client";

import { useTranslations } from "next-intl";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { ViewerModel } from "./types";
import { HIDDEN_LAYER, useViewerStore } from "./store";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

// The dissection stack: skin → muscles → organs → bones. One depth slider
// peels layers off in order; each row can also be shown, hidden or faded.
export function DissectionPanel({ model }: { model: ViewerModel }) {
  const t = useTranslations("viewer");
  const layers = useViewerStore((s) => s.layers);
  const depth = useViewerStore((s) => s.depth);
  const peel = useViewerStore((s) => s.peel);
  const setLayer = useViewerStore((s) => s.setLayer);
  const focusSystem = useViewerStore((s) => s.focusSystem);
  const fur = useViewerStore((s) => s.fur);
  const setFur = useViewerStore((s) => s.setFur);
  const systems = model.systems;
  const max = systems.length - 1;

  return (
    <section aria-labelledby="dissection-title" className="flex flex-col gap-3">
      <div>
        <h2 id="dissection-title" className="plate-label">
          {t("dissection")}
        </h2>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">{t("dissectionHint")}</p>
      </div>

      <div className="px-1">
        <Slider
          min={0}
          max={max}
          step={0.05}
          value={[depth]}
          onValueChange={(v) => peel(Array.isArray(v) ? v[0] : v, systems)}
          aria-label={t("dissection")}
          aria-valuetext={t(`layerName.${systems[Math.min(max, Math.round(depth))].material}`)}
        />
        <div className="mt-1.5 flex justify-between" aria-hidden="true">
          {systems.map((s) => (
            <button
              key={s.systemId}
              type="button"
              tabIndex={-1}
              onClick={() => peel(s.order, systems)}
              className={cn("text-[11px] tabular hover:text-foreground", Math.round(depth) === s.order ? "font-semibold text-foreground" : "text-muted-foreground")}
            >
              {t(`layerName.${s.material}`)}
            </button>
          ))}
        </div>
      </div>

      <ul className="flex flex-col border-t border-border">
        {systems.map((s) => {
          const studying = s.systemId === model.systemId;
          const state = layers[s.systemId] ?? (studying ? { visible: true, opacity: 1 } : HIDDEN_LAYER);
          const name = t(`layerName.${s.material}`);
          return (
            <li key={s.systemId} className="flex flex-col gap-1.5 border-b border-border py-2">
              <div className="flex items-center gap-2">
                <span className="h-5 w-1.5 shrink-0 rounded-[1px]" style={{ background: s.color }} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm leading-tight", studying && "font-semibold")}>{name}</p>
                  {studying ? (
                    <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-accent-foreground">{t("studying")}</p>
                  ) : (
                    <Link
                      href={s.href}
                      onClick={() => focusSystem(s.systemId, systems)}
                      className="text-[11px] text-muted-foreground underline decoration-mark underline-offset-2 hover:text-foreground"
                    >
                      {t("study", { layer: name.toLowerCase() })}
                    </Link>
                  )}
                </div>
                <span className="tabular w-9 text-right text-[11px] text-muted-foreground">{state.visible ? `${Math.round(state.opacity * 100)}%` : ""}</span>
                <button
                  type="button"
                  onClick={() => setLayer(s.systemId, { visible: !state.visible, opacity: state.visible ? state.opacity : 1 })}
                  aria-pressed={state.visible}
                  aria-label={state.visible ? t("hideLayer", { layer: name }) : t("showLayer", { layer: name })}
                  className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:text-foreground"
                >
                  {state.visible ? <EyeIcon className="size-4" /> : <EyeOffIcon className="size-4" />}
                </button>
              </div>
              {state.visible && s.material === "skin" && (
                <label className="flex items-center gap-2 pl-3.5 text-xs text-muted-foreground">
                  <input type="checkbox" checked={fur} onChange={(e) => setFur(e.target.checked)} className="size-3.5 accent-[var(--mark)]" />
                  {t("fur")}
                </label>
              )}
              {state.visible && (
                <div className="pl-3.5 pr-10">
                  <Slider
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={[state.opacity]}
                    onValueChange={(v) => setLayer(s.systemId, { opacity: Array.isArray(v) ? v[0] : v })}
                    aria-label={t("layerOpacity", { layer: name })}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
