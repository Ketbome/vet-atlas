# Plan

Full version with rationale: https://claude.ai/code/artifact/6e52485c-ab1d-4d3b-8c78-793841b0929b

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Stack | Next.js only, static generation | Public educational site, nothing changes at runtime. A backend (NestJS) only if accounts/progress/teacher dashboards are ever needed (phase 5). |
| Content | JSON + MDX in the repo, Zod-validated in CI | Contribution by PR, history, review. |
| 3D | One GLB per species+system, mesh name = structure id | The naming convention is the only contract between 3D and content. |
| First species | Dog, skeletal system | Massey University's 3D Dog Bone Project is the only university-grade dog bone scan set with a licence that allows derivatives (CC BY-SA / CC BY-NC). LMU Munich turned out to be CC BY-NC-ND (checked 2026-09-13), so it cannot be used. |
| Licenses | Code MIT, own content CC BY-SA 4.0, third-party media keep theirs | Non-commercial project, so NC sources are allowed. ND sources are not. The dog skeletal GLB mixes CC BY-SA and CC BY-NC bones, so as a whole it is effectively BY-NC-SA. |
| Hosting | GitHub Pages (static export, models included) | Free; no server, no proxy: `/` picks the locale client-side. |
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
- **2026-10-09**: cat with the same four systems, ahead of phase 3. Skeleton from
  westerly's sculpted feline skeleton (CC BY, every bone separate) with a RISD skull and
  mandible scan; skin from Lova Dahn's "Cat Model" (CC BY); muscles procedural; organs
  from a pixelbeaker feline CT (digestive and urinary), a Cornell feline MRI template
  (brain) and procedural shapes. 22 feline pathologies plus a cat section in 20 shared
  ones. Everything is draft.
- **2026-10-10**: cow (chosen over the rabbit: real scans exist for its stomach and
  heart). Skeleton cut out of a photogrammetry scan of a mounted heifer (Huis van
  Hilde, CC BY-SA; the mount is one fused surface, segmented along the joint creases
  by `scripts/lib/segment.ts`), with a scanned ox metacarpus (PRINMA, CC BY) and
  modeled carpus, ribs 1–3 and 10–13, caudal sternum and tail; stomach (rumen,
  reticulum, omasum, abomasum) from OVC Guelph (CC BY) and heart from the Visible
  Heart Lab (CC BY), the other organs procedural; skin, udder, horns and hooves
  warped from Thunk3D's "Cow" scan (CC BY); muscles from the cat's procedural script.
  21 bovine pathologies with PubMed-verified key studies. Everything is draft.
  Then 12 infectious and zoonotic diseases that were missing: distemper, rabies,
  leptospirosis, heartworm, leishmaniosis, cystic echinococcosis, panleukopenia,
  FeLV/FIV, periodontal disease, BVD, paratuberculosis and brucellosis. Pyometra,
  mammary tumours, otitis externa and bovine pinkeye wait for structures the models
  lack (uterus and mammary glands in dog and cat, ear, cow eyes).
- **2026-10-11**: horse (moved up from phase 4). Skeleton from Diego Luján García's
  sculpted "Horse Skeleton" (CC BY, every bone separate; the walking limbs are mirrored
  so it stands square) with the skull and mandible from a University of Edinburgh CT
  (CC BY); skin, hooves and eyes warped from Lova Dahn's "Equine Model" (CC BY); heart
  from a University of Sarajevo plastinate (CC BY), stomach from shiftstudio (CC BY),
  large colon from OVC Guelph (CC BY), the other organs procedural (cecum, small colon,
  liver, lungs...); muscles from the cow's procedural script plus the superficial and
  deep digital flexors and the suspensory ligament. 84 structures, 19 equine pathologies
  with PubMed-verified key studies, and a horse section in rabies, leptospirosis and
  cervical spondylomyelopathy. Everything is draft.
- _Remaining from phase 1:_ R2 hosting, domain, analytics without cookies,
  veterinary reviewer for `reviewed` status.
- **Phase 2 (weeks 7–14)**: joints, skull types from oVert, 20+ pathologies
  with radiographs/histology, Portuguese, veterinary review of the new systems,
  call for contributors in vet schools.
- **Phase 3 (weeks 15–22)**: cat scans to replace the sculpted bones (needs
  permission, see Sources), species comparison in the viewer.
- **Phase 4 (weeks 23–30)**: quiz mode (localStorage), PWA offline, web
  editor that opens PRs.
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
- Cat: westerly "Feline Skeleton Dec" (Sketchfab, CC BY, sculpted, not a scan);
  RISD Nature Lab cat skull and mandible (Sketchfab, CC BY, Artec scans); Lova Dahn
  "Cat Model" (CC BY); pixelbeaker "Normal Feline Anatomy – Digestive System" (CC BY,
  CT); Cornell feline DTI atlas (CC0). No open cat heart, lung or muscle scans exist.
- MorphoSource Felis catus CT (3D Anatomy Studios, whole-body microCT): Standard
  agreement, needs permission. Would replace the sculpted skeleton and the
  procedural organs. LMU Munich has good loose cat bones, but ND: ask too.
- Cow: Huis van Hilde "Skelet jonge koe" (Sketchfab, CC BY-SA, mounted heifer,
  fused scan; it lacks the carpus and metacarpus, most of the tail and its ribs are
  broken); PRINMA metacarpus (CC BY); OVCanatomy "Bovine Rumen" (CC BY, the whole
  stomach); Visible Heart Lab "Whole Cow Heart Fixed" (CC BY); Thunk3D "Cow" (CC BY,
  sculpt scan). Also usable later: FU Berlin bovine pelvis, MRI PAS and UNLV cow
  skulls, RISD metatarsus (all CC BY), the ETH 1889 SOMSO bull model (CC BY). LMU
  Munich cow bones are ND. Rabbit (checked 2026-10-10): a whole mounted skeleton
  (Univ. Paul Sabatier, CC BY, fused) and good skulls, but no usable skin or organ
  scans.
- Horse: diegoluga "Horse Skeleton" (Sketchfab, CC BY, sculpted, not a scan); Edinburgh
  Open.Ed horse head CT (CC BY); Lova Dahn "Equine Model" (CC BY); UNSA-VF plastinated
  heart, shiftstudio stomach, OVCanatomy "Equine Colon" (all CC BY). Also usable later
  (checked 2026-10-11): RISD horse skull and sacrum, ifmaker_urutai equine atlas, axis,
  humerus, carpus, metacarpus and calcaneus, UoNVet_COI digit with navicular bone, jdb56
  healthy and laminitic hooves, auburton2021 GI tract photogrammetry, OVC equine stifle
  (all CC BY); no open equine brain, lung, liver or muscle scans. The Paris foal skeleton
  (svtavernier) and AMU's coloured copy of the diegoluga skeleton are NC-SA.
- oVert / MorphoSource: dog skulls by breed, CC BY-NC.
- Ohio State Veterinary Histology: CC BY-NC 4.0.
- Wikimedia Commons: per-file CC BY / BY-SA / CC0.
