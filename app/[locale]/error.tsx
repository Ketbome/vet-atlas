"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

export default function LocaleError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations("errors");
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="content" className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col items-start justify-center gap-4 px-4 py-16">
      <h1 className="font-display text-[34px] leading-tight text-ink">{t("title")}</h1>
      <p className="max-w-[56ch] text-muted-foreground">{t("body")}</p>
      <div className="flex gap-2">
        <Button onClick={retry}>{t("retry")}</Button>
        <Button variant="outline" asChild>
          <Link href="/">{t("home")}</Link>
        </Button>
      </div>
    </main>
  );
}
