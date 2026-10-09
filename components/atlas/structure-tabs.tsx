"use client";

import { useEffect, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useViewerStore, type StructureTab } from "@/components/viewer/store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Props = {
  counts: { pathologies: number; media: number };
  description: ReactNode;
  pathologies: ReactNode;
  media: ReactNode;
};

const tabs: StructureTab[] = ["description", "pathologies", "media"];

// Index tabs of a plate: text with an ochre rule under the open one.
const trigger = "flex-none px-0 after:bg-mark data-active:font-semibold";

function isTab(v: string | null): v is StructureTab {
  return tabs.includes(v as StructureTab);
}

// The active tab survives moving between structures (store) and can be shared
// as `?tab=` without turning the statically generated page dynamic.
export function StructureTabs({ counts, description, pathologies, media }: Props) {
  const t = useTranslations("structure");
  const router = useRouter();
  const pathname = usePathname();
  const tab = useViewerStore((s) => s.tab);
  const setTab = useViewerStore((s) => s.setTab);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    if (isTab(fromUrl)) setTab(fromUrl);
  }, [setTab]);

  function onChange(value: string) {
    if (!isTab(value)) return;
    setTab(value);
    router.replace(value === "description" ? pathname : `${pathname}?tab=${value}`, { scroll: false });
  }

  return (
    <Tabs value={tab} onValueChange={onChange} className="mt-5">
      <TabsList variant="line" className="w-full justify-start gap-4 border-b border-border px-0">
        <TabsTrigger value="description" className={trigger}>
          {t("description")}
        </TabsTrigger>
        <TabsTrigger value="pathologies" className={trigger}>
          {t("pathologies")} <span className="tabular text-xs text-muted-foreground">{counts.pathologies}</span>
        </TabsTrigger>
        <TabsTrigger value="media" className={trigger}>
          {t("media")} <span className="tabular text-xs text-muted-foreground">{counts.media}</span>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="description" className="pt-4">
        {description}
      </TabsContent>
      <TabsContent value="pathologies" className="pt-4">
        {pathologies}
      </TabsContent>
      <TabsContent value="media" className="pt-4">
        {media}
      </TabsContent>
    </Tabs>
  );
}
