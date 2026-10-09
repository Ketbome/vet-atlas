import { useTranslations } from "next-intl";
import { Mark } from "./logo";

export function SiteFooter() {
  const t = useTranslations("site");
  return (
    <footer className="mt-auto border-t border-rule">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-4 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div className="flex items-end gap-3">
          <Mark className="h-9 w-12 text-ink/80" />
          <div>
            <p className="font-display text-lg leading-none text-ink">{t("name")}</p>
            <p className="mt-1 max-w-[60ch]">{t("disclaimer")}</p>
          </div>
        </div>
        <p className="max-w-[60ch] sm:text-right">{t("nonCommercial")}</p>
      </div>
    </footer>
  );
}
