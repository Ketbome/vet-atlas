"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { ListTreeIcon } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { ViewerModel } from "./types";
import { StructureTree } from "./structure-tree";
import { ViewerControls } from "./viewer-controls";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const Scene = dynamic(() => import("./scene").then((m) => m.Scene), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-viewer-bg" />,
});

type Props = {
  model: ViewerModel;
  systemHref: string;
  children: ReactNode;
};

export function ViewerShell({ model, systemHref, children }: Props) {
  const t = useTranslations("viewer");
  const router = useRouter();
  const pathname = usePathname();
  const [treeOpen, setTreeOpen] = useState(false);

  const selected = useMemo(() => {
    const slug = pathname.startsWith(systemHref + "/") ? pathname.slice(systemHref.length + 1).split("/")[0] : null;
    return model.structures.find((s) => s.slug === slug)?.id ?? null;
  }, [pathname, systemHref, model.structures]);

  const onSelect = useCallback(
    (id: string) => {
      const s = model.structures.find((x) => x.id === id);
      if (s) router.push(s.href);
    },
    [model.structures, router],
  );

  const onDeselect = useCallback(() => {
    if (selected) router.push(systemHref);
  }, [selected, router, systemHref]);

  const tree = <StructureTree model={model} selected={selected} onNavigate={() => setTreeOpen(false)} />;

  return (
    <div className="grid min-h-[calc(100dvh-3.5rem)] grid-rows-[min(52dvh,520px)_auto] lg:h-[calc(100dvh-3.5rem)] lg:grid-cols-[272px_minmax(0,1fr)_minmax(360px,420px)] lg:grid-rows-1">
      <aside className="hidden overflow-y-auto border-r border-border bg-sidebar lg:block">{tree}</aside>

      <section className="relative bg-viewer-bg lg:h-full" aria-label="3D">
        <Scene model={model} selected={selected} onSelect={onSelect} onDeselect={onDeselect} />

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <div className="pointer-events-auto lg:hidden">
            <Sheet open={treeOpen} onOpenChange={setTreeOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm">
                  <ListTreeIcon data-icon="inline-start" />
                  {model.structures.length}
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[300px] p-0">
                <SheetHeader className="sr-only">
                  <SheetTitle>{t("layers")}</SheetTitle>
                </SheetHeader>
                <div className="h-full overflow-y-auto">{tree}</div>
              </SheetContent>
            </Sheet>
          </div>
          <div className="pointer-events-auto ml-auto">
            <ViewerControls hasSelection={selected !== null} onDeselect={onDeselect} />
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 p-3 text-[11px] leading-tight text-muted-foreground">
          {model.placeholder && (
            <p className="pointer-events-auto w-fit rounded-md border border-eosin/40 bg-eosin-soft px-2 py-1 text-foreground/80">{t("placeholder")}</p>
          )}
          <p className="hidden sm:block">{t("hint")}</p>
          <p>{t("attribution", { source: model.attribution.source, license: model.attribution.license })}</p>
        </div>
      </section>

      <aside className="min-w-0 overflow-y-auto border-t border-border bg-card lg:border-t-0 lg:border-l">{children}</aside>
    </div>
  );
}
