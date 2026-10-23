import { defineRouting } from "next-intl/routing";

// English lives at the root and other locales under their prefix. Static
// export has no middleware, so scripts/flatten-locale.ts moves the built
// /en pages to the root (and next.config.ts rewrites them in dev).
export const routing = defineRouting({
  locales: ["en", "es"],
  defaultLocale: "en",
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];
