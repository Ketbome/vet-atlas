import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  output: "export",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH,
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["three"],
};

const withNextIntl = createNextIntlPlugin();
export default withNextIntl(nextConfig);
