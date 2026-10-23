import fs from "node:fs";
import path from "node:path";
import { routing } from "../i18n/routing";
import { localeUrl } from "../lib/seo";

// Static export always prefixes the locale. Move the default locale's pages
// to the root (localePrefix "as-needed") and leave a redirect at each old URL.
const out = path.join(process.cwd(), "out");
const from = path.join(out, routing.defaultLocale);

const pages = (fs.readdirSync(from, { recursive: true }) as string[])
  .filter((f) => path.basename(f) === "index.html")
  .map((f) => path.dirname(f).split(path.sep).join("/"));

fs.cpSync(from, out, { recursive: true });
fs.rmSync(from, { recursive: true });

for (const page of pages) {
  const url = localeUrl(routing.defaultLocale, page === "." ? "/" : `/${page}`);
  const dir = path.join(from, page);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><link rel="canonical" href="${url}"><meta http-equiv="refresh" content="0;url=${url}"></head><body><a href="${url}">${url}</a></body></html>\n`,
  );
}

console.log(`Moved ${pages.length} /${routing.defaultLocale} pages to the root`);
