# Plan

Full version with rationale: https://claude.ai/code/artifact/6e52485c-ab1d-4d3b-8c78-793841b0929b

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Stack | Next.js only, static generation | Public educational site, nothing changes at runtime. A backend (NestJS) only if accounts/progress/teacher dashboards are ever needed (phase 5). |
| Content | JSON + MDX in the repo, Zod-validated in CI | Contribution by PR, history, review. |
| 3D | One GLB per species+system, mesh name = structure id | The naming convention is the only contract between 3D and content. |
| First species | Dog, skeletal system | Massey University's 3D Dog Bone Project is the only university-grade dog bone scan set with a licence that allows derivatives (CC BY-SA / CC BY-NC). LMU Munich turned out to be CC BY-NC-ND (checked 2026-09-13), so it cannot be used. Cat depends on a non-commercial MorphoSource dataset. |
| Licenses | Code MIT, own content CC BY-SA 4.0, third-party media keep theirs | Non-commercial project, so NC sources are allowed. ND sources are not. The dog skeletal GLB mixes CC BY-SA and CC BY-NC bones, so as a whole it is effectively BY-NC-SA. |
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
- **Phase 1 (MVP, weeks 2–6)**: real scans in the viewer (done 2026-09-13:
  Massey partial skeleton, 14 bones, `scripts/build-dog-skeletal.ts` with
  meshopt).
- **2026-10-08**: complete dog skeleton (115 meshes: CT pelvic paws, sacrum and tail
  from a greyhound CT; forepaw from Scan the World; vertebrae, ribs 1–13 and sternum
  modeled from our scans; os penis), plus three new systems: integumentary (skin
  registered onto the skeleton), muscular (34 procedural muscles, illustrative) and
  visceral (16 organs: CT heart, liver, intestine, kidneys; Cornell brain atlas;
  the rest procedural). Viewer: see-through layers per system, exploded view, and a
  one-piece page at `/[locale]/3d/...`. Everything new is draft.
- _Remaining from phase 1:_ R2 hosting, domain, analytics without cookies,
  veterinary reviewer for `reviewed` status.
- **Phase 2 (weeks 7–14)**: joints, skull types from oVert, 20+ pathologies
  with radiographs/histology, Portuguese, veterinary review of the new systems,
  call for contributors in vet schools.
- **Phase 3 (weeks 15–22)**: cat skeleton from MorphoSource, shared
  pathologies extended, species comparison in the viewer.
- **Phase 4 (weeks 23–30)**: quiz mode (localStorage), PWA offline, web
  editor that opens PRs, cow or horse.
- **Phase 5 (only if justified)**: NestJS + Postgres for accounts and teacher
  dashboards.

## Sources

- Massey University 3D Dog Bone Project (nzfauna on Sketchfab): 14 dog bones,
  CC BY-SA / CC BY-NC per model. Skeleton base; the other bones are fitted to it.
- Greyhound pelvic limb CT (Hutchinson, figshare, CC BY): patella, tarsus,
  metatarsus, phalanges, sacrum and caudal vertebrae via `scripts/ct/`.
- Scan the World "Front leg of a dog" (Zenodo, CC BY-NC-SA): carpus, metacarpus,
  thoracic phalanges. "Dog Baculum" (Sketchfab, CC BY): os penis.
- "Canine Model" by Lova Dahn (Sketchfab, CC BY): skin and claws, warped onto
  the skeleton.
- pixelbeaker "Normal Abdomen" and "Normal Canine Heart" (Sketchfab, CC BY, CT
  segmentations) and the Cornell canine brain atlas (CC0): organs.
- NC State `ncsu:cvm:31` on MorphoSource: 55 separate bones of one dog (spine
  complete, both sides). MorphoSource Standard agreement forbids republishing
  without permission: ask Christopher Walker (NCSU). Would replace the modeled
  vertebrae.
- LMU Munich vetanatMunich (Sketchfab): CC BY-NC-ND, not usable. Ask them for
  permission before considering it.
- Vetanat UZH (Sketchfab): not downloadable. Same: ask for permission.
- Muscles: no openly licensed dog muscle models exist (rechecked 2026-10-08);
  ours are procedural. Candidates needing permission: Vetanat UZH plastinates,
  William Ryerson forelimb musculature, UNSA-VF, LMU Munich.
- LMU Munich manubrium sterni (CC BY) and VetAgro Sup Lyon hyoid + larynx
  plastinate (CC BY): integrated 2026-09-13, placed by hand in
  `scripts/build-dog-skeletal.ts`.
- RISD Nature Lab (Sketchfab): dog pelvis with sacrum, CC BY, but scanned as
  one fused shell, so the sacrum cannot be separated. University of Edinburgh
  Open.Ed: dog skulls by CT, CC BY (dolichocephalic and brachycephalic); would
  need a breed-variant concept in the content model.
- MorphoSource Felis catus CT (3D Anatomy Studios): NC, archive derivatives.
- oVert / MorphoSource: dog skulls by breed, CC BY-NC.
- Ohio State Veterinary Histology: CC BY-NC 4.0.
- Wikimedia Commons: per-file CC BY / BY-SA / CC0.
