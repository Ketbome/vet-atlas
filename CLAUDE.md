@AGENTS.md

# Vet Atlas

Open-source 3D veterinary anatomy atlas for students. Next.js 16 App Router,
static export to GitHub Pages, no database. Content is files under `content/` validated by
Zod; the 3D viewer is React Three Fiber.

## Commands

- `pnpm dev` / `pnpm build`
- Deploy: push to `main` runs `.github/workflows/pages.yml` (`output: "export"`) to
  https://vet-atlas.ketbome.com (`NEXT_PUBLIC_SITE_URL`; `NEXT_PUBLIC_BASE_PATH` is empty
  with the custom domain). No proxy/middleware or server features.
- English is the default locale at `/`, Spanish under `/es`. The export always prefixes
  the locale, so `pnpm build` runs `scripts/flatten-locale.ts` to move `out/en` to the root
  (leaving redirects at `/en/...`); in dev a rewrite in `next.config.ts` does the same.
- SEO: `app/sitemap.ts`, `app/robots.ts`, `lib/seo.ts` (canonical + hreflang per page).
  New pages need `alternates(locale, path)` in `generateMetadata`.
- `pnpm validate` content integrity + GLB mesh names (run after touching content or models)
- `pnpm lint`, `pnpm next typegen && pnpm typecheck`
- `pnpm models:dog` / `models:dog-integumentary` / `models:dog-muscular` /
  `models:dog-visceral` rebuild one
  system GLB under `public/models/dog/` (needs `SKETCHFAB_TOKEN` in `.env.local`; sources
  cached in `.cache/models/`). Rebuild skeletal first: the others anchor on its bones.
  Same for the cat: `pnpm models:cat` / `models:cat-integumentary` / `models:cat-muscular` /
  `models:cat-visceral` (`public/models/cat/`), the cow: `pnpm models:cow` /
  `models:cow-visceral` / `models:cow-muscular` / `models:cow-integumentary`
  (`public/models/cow/`, in that order), and the horse: `pnpm models:horse` /
  `models:horse-visceral` / `models:horse-muscular` / `models:horse-integumentary`
  (`public/models/horse/`, same order).
- `pnpm brand` regenerates the logo mark and app icons from the scanned skull
  (`components/atlas/mark-path.ts`, `app/icon.svg`, `app/apple-icon.png`)
- CT steps live in `scripts/ct/*.py`; set up once with
  `python3.14 -m venv .venv && .venv/bin/pip install -r scripts/ct/requirements.txt`

## Layout

- `app/[locale]/[species]/[system]/layout.tsx` mounts the viewer once; child
  pages render the right-hand panel. The selected structure is the URL.
- `lib/content/load.ts` is the only reader of `content/`. Add fields in
  `lib/content/schema.ts` first.
- Mesh names in GLBs = structure id with `.` → `_` (`lib/content/mesh.ts`).
- One GLB per species+system, all in one frame (metres, Y up, faces -Z, left = -X).
  Shared build helpers in `scripts/lib/glb.ts`; `scripts/lib/segment.ts` cuts fused scans
  into parts. Systems are a dissection stack
  (`order`: skin 0 → bone 3, `material` sets the surface finish); the viewer
  loads the studied system plus any visible layer, and picks across all of them.
  `/[locale]/3d/...` shows one piece. Structure `color` overrides the system colour.
- Structure folders are shared by all systems of a species: slugs must be unique.
- UI strings in `messages/*.json`; translatable content in `<locale>.mdx`.

## Rules

- Never add media or models without source, license and attribution. No ND licenses.
- New content is `review.status: draft`. Only veterinary reviewers flip it.
- Project is non-commercial; do not add ads or paid features.
- Keep the viewer offline-capable: no assets fetched from external CDNs.
- Docs: `docs/plan.md` (roadmap and decisions).
