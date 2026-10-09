import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

export default async function LocaleNotFound() {
  const t = await getTranslations("errors");
  return (
    <main id="content" className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col items-start justify-center gap-4 px-4 py-16">
      <h1 className="font-display text-[34px] leading-tight text-ink">{t("notFoundTitle")}</h1>
      <p className="max-w-[56ch] text-muted-foreground">{t("notFoundBody")}</p>
      <Button asChild>
        <Link href="/">{t("home")}</Link>
      </Button>
    </main>
  );
}
