@AGENTS.md

# Vet Atlas

Open-source 3D veterinary anatomy atlas for students. Next.js 16 App Router,
static generation, no database. Content is files under `content/` validated by
Zod; the 3D viewer is React Three Fiber.

## Commands

- `pnpm dev` / `pnpm build`
- `pnpm validate` content integrity + GLB mesh names (run after touching content or models)
- `pnpm lint`, `pnpm next typegen && pnpm typecheck`
- `pnpm models:placeholder` regenerate the schematic GLB

## Layout

- `app/[locale]/[species]/[system]/layout.tsx` mounts the viewer once; child
  pages render the right-hand panel. The selected structure is the URL.
- `lib/content/load.ts` is the only reader of `content/`. Add fields in
  `lib/content/schema.ts` first.
- Mesh names in GLBs = structure id with `.` → `_` (`lib/content/mesh.ts`).
- UI strings in `messages/*.json`; translatable content in `<locale>.mdx`.

## Rules

- Never add media or models without source, license and attribution. No ND licenses.
- New content is `review.status: draft`. Only veterinary reviewers flip it.
- Project is non-commercial; do not add ads or paid features.
- Keep the viewer offline-capable: no assets fetched from external CDNs.
- Docs: `docs/plan.md` (roadmap and decisions).
