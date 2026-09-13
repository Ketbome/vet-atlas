# Plan

Full version with rationale: https://claude.ai/code/artifact/6e52485c-ab1d-4d3b-8c78-793841b0929b

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Stack | Next.js only, static generation | Public educational site, nothing changes at runtime. A backend (NestJS) only if accounts/progress/teacher dashboards are ever needed (phase 5). |
| Content | JSON + MDX in the repo, Zod-validated in CI | Contribution by PR, history, review. |
| 3D | One GLB per species+system, mesh name = structure id | The naming convention is the only contract between 3D and content. |
| First species | Dog, skeletal system | Only source with university-grade CC BY bone scans (LMU Munich). Cat depends on a non-commercial MorphoSource dataset. |
| Licenses | Code MIT, own content CC BY-SA 4.0, third-party media keep theirs | Non-commercial project, so NC sources are allowed. ND sources are not. |
| Hosting | Vercel (pages) + Cloudflare R2 (models) | Free egress for GLBs. |
| Name | "Vet Atlas" is a working name | Domain will be `<name>.ketbome.com` until decided. |

## Content model

Species → System → Structure. Pathology is cross-cutting (many species, many
structures). Media and Source carry license and attribution. IDs are
`species.system.structure`. Latin NAV name is the canonical key.

## Roadmap

- **Phase 0 (done)**: repo, Next 16, i18n es/en, schemas, loader, validator,
  viewer with selection/isolation/opacity/presets/deep links, search (⌘K),
  placeholder GLB, 9 pelvic-limb structures, 6 pathologies, 19 CC images, CI.
- **Phase 1 (MVP, weeks 2–6)**: replace placeholder with LMU Munich CC BY
  bones (pelvic + thoracic limb), Blender pipeline + meshopt, R2 hosting,
  domain, analytics without cookies, veterinary reviewer for `reviewed` status.
- **Phase 2 (weeks 7–14)**: full dog skeleton, joints, skull types from oVert,
  20+ pathologies with radiographs/histology, Portuguese, first non-skeletal
  system, call for contributors in vet schools.
- **Phase 3 (weeks 15–22)**: cat skeleton from MorphoSource, shared
  pathologies extended, species comparison in the viewer.
- **Phase 4 (weeks 23–30)**: quiz mode (localStorage), PWA offline, web
  editor that opens PRs, cow or horse.
- **Phase 5 (only if justified)**: NestJS + Postgres for accounts and teacher
  dashboards.

## Sources

- LMU Munich vetanatMunich (Sketchfab): dog bones, CC BY per model. MVP base.
- Vetanat UZH (Sketchfab): verify per model.
- MorphoSource Felis catus CT (3D Anatomy Studios): NC, archive derivatives.
- oVert / MorphoSource: dog skulls by breed, CC BY-NC.
- Ohio State Veterinary Histology: CC BY-NC 4.0.
- Wikimedia Commons: per-file CC BY / BY-SA / CC0.
