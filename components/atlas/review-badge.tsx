import { useTranslations } from "next-intl";
import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import type { Structure } from "@/lib/content/schema";

export function ReviewBadge({ review }: { review: Structure["review"] }) {
  const t = useTranslations("review");
  if (review.status === "reviewed") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CircleCheckIcon className="size-3.5 text-chart-3" />
        {t("reviewed", { by: review.by ?? "" })}
      </p>
    );
  }
  return (
    <p className="flex items-start gap-1.5 rounded-md border border-eosin/30 bg-eosin-soft px-2.5 py-1.5 text-xs text-foreground/80" title={t("draftHelp")}>
      <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-eosin" />
      {t("draft")}
    </p>
  );
}
