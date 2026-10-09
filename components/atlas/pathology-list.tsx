import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { Pathology } from "@/lib/content/schema";
import { Badge } from "@/components/ui/badge";

export type PathologySummary = { pathology: Pathology; title: string; summary: string; href: string };

export function PathologyList({ items, emptyText }: { items: PathologySummary[]; emptyText: string }) {
  const t = useTranslations("pathology");
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="divide-y divide-border">
      {items.map(({ pathology, title, summary, href }) => (
        <li key={pathology.id}>
          <Link href={href} className="group block py-3 outline-none first:pt-0 focus-visible:ring-3 focus-visible:ring-ring/50">
            <div className="flex items-center gap-2">
              <span className="font-medium group-hover:text-primary">{title}</span>
              <Badge variant="outline" className="border-eosin/40 text-xs font-normal text-eosin">
                {t(`category.${pathology.category}`)}
              </Badge>
            </div>
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{summary}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
