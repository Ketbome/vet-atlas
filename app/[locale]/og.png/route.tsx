import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { loadContent, localeName } from "@/lib/content/load";
import { MARK_PATH } from "@/components/atlas/mark-path";

export const dynamic = "force-static";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Plate colours (globals.css, light theme) in sRGB: satori has no oklch.
const paper = "#f4f1ea";
const ink = "#33271d";
const muted = "#6e6255";
const ochre = "#b8892f";

// Build-time only: the PNG is exported as a static file.
async function font(family: string, text: string) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}&text=${encodeURIComponent(text)}`)).text();
  const url = css.match(/src: url\((.+?)\) format/)?.[1];
  if (!url) throw new Error(`No font for ${family}`);
  return (await fetch(url)).arrayBuffer();
}

// Link preview image, one per locale (/og.png, /es/og.png); see layout metadata.
export async function GET(_: Request, { params }: RouteContext<"/[locale]/og.png">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site" });
  const species = loadContent()
    .species.filter((s) => s.status === "published")
    .map((s) => localeName(s.name, locale))
    .join(" · ");
  const fonts = [
    { name: "Caslon", data: await font("Libre+Caslon+Display", t("name")), weight: 400 as const },
    { name: "Grotesk", data: await font("Schibsted+Grotesk", t("tagline") + species.toUpperCase()), weight: 400 as const },
  ];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: paper, padding: 36, fontFamily: "Grotesk" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", border: `2px solid ${ink}`, padding: "56px 64px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
            <svg width="150" height="150" viewBox="0 0 100 100">
              <path d={MARK_PATH} fill={ink} />
            </svg>
            <div style={{ fontFamily: "Caslon", fontSize: 124, color: ink, letterSpacing: -2, lineHeight: 1 }}>{t("name")}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <div style={{ width: 96, height: 5, background: ochre }} />
            <div style={{ fontSize: 46, color: ink, lineHeight: 1.2, maxWidth: 900 }}>{t("tagline")}</div>
            <div style={{ fontSize: 28, color: muted, letterSpacing: 3, textTransform: "uppercase" }}>{species}</div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts },
  );
}
