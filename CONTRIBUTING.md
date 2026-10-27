# Contributing

Thanks for helping build an open veterinary anatomy atlas. There are three
ways to contribute and none of them require touching the viewer code.

## 1. Fix or translate a text

Every entry has an "Edit on GitHub" link. It opens the MDX file for that
language. Edit it, open a pull request, done. If a translation is missing,
copy `en.mdx` to `<locale>.mdx` next to it and translate; keep the frontmatter
(`title`, `summary`).

## 2. Add a structure or a pathology

Content is plain files under `content/`:

```
content/species/<species>/structures/<slug>/meta.json   non-translatable data
content/species/<species>/structures/<slug>/es.mdx      Spanish text
content/species/<species>/structures/<slug>/en.mdx      English text
content/pathologies/<slug>/{meta.json, es.mdx, en.mdx}
content/species/<species>/media.json                    images with license
```

Rules enforced by `pnpm validate` (CI runs it on every PR):

- IDs are `species.system.structure`, lowercase, hyphens allowed.
- Every mesh listed in `meta.json` must exist in the system's GLB, named with
  `_` instead of `.` (`dog.skeletal.femur.L` → `dog_skeletal_femur_L`).
- Every pathology, media and related id must exist.
- Media entries need `url`, `source`, `license` and `attribution`. No
  "NoDerivs" licenses. Non-commercial (NC) is fine.
- New entries start with `"review": { "status": "draft" }`. Once every statement
  is checked against the sources listed in `references`, it can move to
  `sourced` (validation fails if `references` is empty). A reviewer with
  veterinary training flips it to `reviewed` in a follow-up PR.

Pathology texts must cite references (`references` in `meta.json`).

## 3. Add a 3D model

See `models/README.md` for the pipeline (Blender → GLB → validation) and the
naming convention. Only sources that allow derivatives are accepted; record the
source in `content/sources.json` and each file in `models/manifest.json`.

## Development

```
pnpm install
pnpm models:placeholder   # regenerates the schematic placeholder GLB
pnpm dev
pnpm validate && pnpm lint && pnpm typecheck
```

Commits follow Conventional Commits (`feat:`, `fix:`, `content:`, `docs:`).
