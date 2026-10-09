@AGENTS.md

# Vet Atlas

Open-source 3D veterinary anatomy atlas for students. Next.js 16 App Router,
static generation, no database. Content is files under `content/` validated by
Zod; the 3D viewer is React Three Fiber.

## Commands

- `pnpm dev` / `pnpm build`
- `pnpm validate` content integrity + GLB mesh names (run after touching content or models)
- `pnpm lint`, `pnpm next typegen && pnpm typecheck`
- `pnpm models:dog` / `models:dog-integumentary` / `models:dog-muscular` /
  `models:dog-visceral` rebuild one
  system GLB under `public/models/dog/` (needs `SKETCHFAB_TOKEN` in `.env.local`; sources
  cached in `.cache/models/`). Rebuild skeletal first: the others anchor on its bones.
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
  Shared build helpers in `scripts/lib/glb.ts`. Systems are a dissection stack
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
