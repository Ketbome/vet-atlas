"use client";

import { SearchIcon } from "lucide-react";
import { ShortcutKbd } from "./shortcut-kbd";
import { OPEN_SEARCH } from "./search-command";

// Opens the header's search palette from elsewhere on the page.
export function SearchButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_SEARCH))}
      className="inline-flex h-12 items-center gap-2.5 rounded-[3px] border border-rule px-5 text-base text-foreground transition-colors hover:border-ink/40 hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <SearchIcon className="size-4 text-muted-foreground" aria-hidden="true" />
      <span className="tabular">{label}</span>
      <span className="hidden sm:inline-flex">
        <ShortcutKbd />
      </span>
    </button>
  );
}
