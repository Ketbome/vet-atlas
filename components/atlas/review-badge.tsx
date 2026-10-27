import { useTranslations } from "next-intl";
import { BookCheckIcon, CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import type { Structure } from "@/lib/content/schema";

export function ReviewBadge({ review }: { review: Structure["review"] }) {
  const t = useTranslations("review");
  if (review.status === "reviewed") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CircleCheckIcon className="size-3.5 text-chart-4" aria-hidden="true" />
        {review.by ? t("reviewed", { by: review.by }) : t("reviewedAnon")}
      </p>
    );
  }
  const sourced = review.status === "sourced";
  const Icon = sourced ? BookCheckIcon : CircleAlertIcon;
  return (
    <p className="flex items-start gap-2 rounded-md bg-muted px-2.5 py-2 text-xs leading-snug text-muted-foreground">
      <Icon className={`mt-px size-3.5 shrink-0 ${sourced ? "text-chart-4" : "text-chart-3"}`} aria-hidden="true" />
      <span>
        <span className="font-medium text-foreground/85">{t(sourced ? "sourced" : "draft")}.</span> {t(sourced ? "sourcedHelp" : "draftHelp")}
      </span>
    </p>
  );
}
