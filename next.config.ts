import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const dev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  output: dev ? undefined : "export",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH,
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["three"],
};

// The export serves English from the root (scripts/flatten-locale.ts); the
// dev server only knows /en, so map unprefixed paths there. Export mode would
// reject the rewritten params, hence no `output` in dev.
if (dev) {
  nextConfig.rewrites = async () => [
    { source: "/:path((?!(?:en|es)(?:/|$)|_next/|models/|icon|apple-icon|sitemap|robots).*)", destination: "/en/:path" },
  ];
}

const withNextIntl = createNextIntlPlugin();
export default withNextIntl(nextConfig);
