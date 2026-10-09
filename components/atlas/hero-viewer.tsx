"use client";

import { useCallback } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { ViewerModel } from "@/components/viewer/types";

const Scene = dynamic(() => import("@/components/viewer/scene").then((m) => m.Scene), { ssr: false });

// The home hero: the real model, slowly orbiting. Clicking a bone opens it.
export function HeroViewer({ model, caption }: { model: ViewerModel; caption: string }) {
  const t = useTranslations("home");
  const router = useRouter();
  const onPick = useCallback(
    (id: string) => {
      const s = model.structures.find((x) => x.id === id);
      if (s) router.push(s.href);
    },
    [model.structures, router],
  );

  return (
    <figure className="w-full">
      <div className="relative aspect-[4/3] w-full overflow-hidden border border-rule bg-viewer-bg sm:aspect-[5/4] lg:aspect-square">
        <Scene model={model} selected={null} onPick={onPick} orbit />
      </div>
      <figcaption className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-heading text-sm italic text-ink">{caption}</span>
        <span className="text-xs text-muted-foreground">{t("heroHint")}</span>
      </figcaption>
    </figure>
  );
}
