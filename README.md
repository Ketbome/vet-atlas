# Vet Atlas

Open, multilingual 3D veterinary anatomy for students. Models are split into
selectable structures; each structure has its Latin (NAV) name, a description,
the diseases that affect it and real images (specimens, radiographs,
histology).

Working name. Non-commercial. Code MIT, content CC BY-SA 4.0.

## Status

- Dog, skeletal system, pelvic limb: 9 structures, 6 pathologies, es/en.
- The 3D model is a **schematic placeholder** until the LMU Munich scans are
  integrated (see `models/README.md`).

## Stack

Next.js 16 (App Router, static generation), TypeScript, Tailwind 4 + shadcn/ui,
next-intl, React Three Fiber + drei, Zustand, Zod, Fuse.js, MDX.
No database: content lives in the repo and is validated in CI.

## Run

```
pnpm install
pnpm dev
```

`pnpm validate` checks content integrity and mesh names. `pnpm lint`,
`pnpm typecheck`, `pnpm build` as usual.

## Structure

```
app/[locale]/               routes (home, species, system viewer, structure, pathology)
components/viewer/          3D viewer (R3F): scene, model, controls, tree, store
components/atlas/           site chrome, search, MDX rendering, badges
content/                    species, systems, structures, pathologies, media, sources
lib/content/                Zod schemas, loaders, search index
models/                     pipeline docs, manifest, Blender sources (LFS)
public/models/              GLB files served in development
scripts/                    validate-content, build-placeholder-model
messages/                   UI strings per locale
docs/                       plan and design notes
```

## Contributing

See `CONTRIBUTING.md`. Content fixes are one-file PRs; the "Edit on GitHub"
link on every page opens the right file.
