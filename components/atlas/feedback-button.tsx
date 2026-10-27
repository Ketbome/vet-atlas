"use client";

import { useTranslations } from "next-intl";
import { CircleAlertIcon, LightbulbIcon, MessageSquareIcon, MousePointerClickIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const NEW_ISSUE = "https://github.com/ketbome/vet-atlas/issues/new";

const kinds = [
  { template: "content-error", icon: CircleAlertIcon },
  { template: "usability", icon: MousePointerClickIcon },
  { template: "suggestion", icon: LightbulbIcon },
] as const;

// Opens a GitHub issue form with the current page already filled in.
function issueUrl(template: string) {
  const params = new URLSearchParams({ template: `${template}.yml`, page: location.href });
  return `${NEW_ISSUE}?${params}`;
}

export function FeedbackButton() {
  const t = useTranslations("feedback");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("label")}
        className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:bg-muted data-[state=open]:text-foreground"
      >
        <MessageSquareIcon className="size-4" aria-hidden="true" />
        <span className="hidden lg:inline">{t("label")}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("intro")}</DropdownMenuLabel>
        {kinds.map(({ template, icon: Icon }) => (
          <DropdownMenuItem key={template} onSelect={() => window.open(issueUrl(template), "_blank", "noopener")}>
            <Icon aria-hidden="true" />
            <span className="flex flex-col">
              <span>{t(`${template}.title`)}</span>
              <span className="text-xs text-muted-foreground">{t(`${template}.hint`)}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
