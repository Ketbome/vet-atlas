import { ChevronRightIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";

type Item = { href: string; label: string };

export function Breadcrumb({ items }: { items: Item[] }) {
  return (
    <nav aria-label="breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {items.map((item, i) => (
          <li key={item.href} className="flex items-center gap-1">
            {i > 0 && <ChevronRightIcon className="size-3 opacity-60" aria-hidden="true" />}
            <Link href={item.href} className="rounded-sm py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              {item.label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
