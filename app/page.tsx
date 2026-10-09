import { routing } from "@/i18n/routing";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const locales = JSON.stringify(routing.locales);
const redirect = `var l=(navigator.language||"").slice(0,2);location.replace("${base}/"+(${locales}.indexOf(l)>-1?l:"${routing.defaultLocale}")+"/")`;

export default function RootPage() {
  return (
    <html lang={routing.defaultLocale}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: redirect }} />
        <noscript>
          <a href={`${base}/${routing.defaultLocale}/`}>Vet Atlas</a>
        </noscript>
      </body>
    </html>
  );
}
