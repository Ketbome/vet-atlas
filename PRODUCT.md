# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Veterinary students, mainly at Spanish-speaking faculties. Primary situation:
studying at a desk on a laptop, reviewing for anatomy exams alongside notes
and the Nomina Anatomica Veterinaria (NAV). Long sessions, mouse and keyboard.

Phone and tablet use is first class, not a fallback: the same student consults
the atlas with a bone in hand or between classes.

Secondary audiences (not yet confirmed): teachers projecting in class,
veterinary reviewers validating content, contributors sending PRs.

## Product Purpose

An open 3D anatomy atlas where models are split into selectable structures.
Each structure has its Latin NAV name, a description, the pathologies that
affect it and real images (specimens, radiographs, histology). Success is a
student finding a structure fast, understanding it, and coming back.

## Positioning

Open and free. No account, no payment, code MIT and content CC BY-SA 4.0,
contributable by pull request. Serious alternatives (Easy Anatomy, Biosphera,
IVALA) are paid. Pathology-linked anatomy and es/en with NAV nomenclature are
supporting strengths, not the primary claim.

## Operating Context

- Static site, no database. Content lives in `content/` (JSON + MDX) and is
  validated with Zod in CI. The selected structure is the URL, so any view is
  linkable.
- Search with ⌘K / `/` across structures and pathologies in either language.
- Viewer: one GLB per species+system, mesh name = structure id. Systems form a
  dissection stack (skin → muscles → organs → bones) that can be peeled with
  one slider or shown per layer; a click on any visible layer opens that
  structure. Selection with an atlas leader label, isolation, exploded view,
  orientation rose (anatomical views), hover sync between tree and model,
  view state in the URL, keyboard shortcuts. One-piece page at `/3d/...`.
- Every page has an "Edit on GitHub" link that opens the right content file.
- Content review workflow: new content is `review.status: draft`; only
  veterinary reviewers flip it to `reviewed`. The badge is visible to users.

## Capabilities and Constraints

- Current scope: dog, four systems (integumentary, muscular, visceral,
  skeletal), 84 structures, 6 pathologies, es/en. Cat, cow and horse are
  announced as upcoming.
- Models mix fidelities: scans and CT (most bones, heart, liver, kidneys,
  paws), modeled from scans (vertebrae, ribs, skin fitted to the skeleton) and
  illustrative procedural shapes (all muscles, some organs). The fidelity is
  shown per structure; design must not hide it.
- Offline-capable viewer: no assets from external CDNs. Fonts via
  `next/font`, models served from the site (R2 in production).
- Non-commercial: no ads, no paid features, no accounts.
- Media and models only with source, license and attribution. No ND licenses.
- Rendering: WebGL today; WebGPU is acceptable if adopted. A WebGL-less
  fallback is not a requirement, but the text pages must remain readable
  when the scene fails to load.
- Undecided: final product name and domain ("Vet Atlas" is a working name).

## Brand Commitments

- Name "Vet Atlas" (working). The mark is the lateral silhouette of the
  atlas's own scanned dog skull (`scripts/build-brand.ts`), bone on an ink
  plate; `components/atlas/logo.tsx`, `app/icon.svg`.
- Voice: study material, precise and sober. Latin NAV names are always shown
  next to the vernacular name. Disclaimer on every page: does not replace
  diagnosis or veterinary consultation.

## Evidence on Hand

- 84 structure docs in `content/species/dog/structures/*/{es,en}.mdx`, all
  draft.
- 6 pathologies in `content/pathologies/`.
- 19 CC-licensed images in `content/species/dog/media.json` with attribution.
- Sources list in `content/sources.json` and `docs/plan.md`.
- No testimonials, adoption numbers, institutional partners or reviewer
  names yet. Do not fabricate any of these.

## Product Principles

- The structure is the unit. Everything (URL, search, tree, model, doc) points
  at one structure.
- Free and open is the promise; nothing on the surface should gate, upsell or
  ask for an account.
- Name in Latin always visible; the vernacular is the entry point, NAV is the
  reference.
- Honest about maturity: draft badges, placeholder notice and licenses stay
  visible.
- Works on a phone with one hand, and on a laptop for hours.

## Accessibility & Inclusion

No formal standard required. Baseline: keyboard navigation for search, tree
and controls; `prefers-reduced-motion` respected; contrast readable in light
and dark themes; touch targets usable on small screens.
