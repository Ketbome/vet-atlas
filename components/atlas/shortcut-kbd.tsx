"use client";

import { useSyncExternalStore } from "react";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

const noop = () => () => {};
const isApple = () => /Mac|iPhone|iPad/.test(navigator.platform);

// Renders ⌘ on Apple devices and Ctrl elsewhere; the server guess is ⌘.
export function ShortcutKbd({ keyName = "K" }: { keyName?: string }) {
  const apple = useSyncExternalStore(noop, isApple, () => true);
  return (
    <KbdGroup>
      <Kbd>{apple ? "⌘" : "Ctrl"}</Kbd>
      <Kbd>{keyName}</Kbd>
    </KbdGroup>
  );
}
