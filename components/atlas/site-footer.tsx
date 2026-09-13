import { useTranslations } from "next-intl";

export function SiteFooter() {
  const t = useTranslations("site");
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>{t("disclaimer")}</p>
        <p>{t("nonCommercial")}</p>
      </div>
    </footer>
  );
}
