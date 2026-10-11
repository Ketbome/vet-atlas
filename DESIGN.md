---
name: Vet Atlas
description: Open 3D veterinary anatomy, built for studying
colors:
  plate-paper: "oklch(0.966 0.005 85)"
  plate-card: "oklch(0.984 0.004 85)"
  plate-sidebar: "oklch(0.955 0.006 85)"
  plate-muted: "oklch(0.935 0.007 85)"
  viewer-ground: "oklch(0.938 0.007 85)"
  sepia-ink: "oklch(0.25 0.03 55)"
  press-ink: "oklch(0.27 0.032 55)"
  ink-on-press: "oklch(0.97 0.005 85)"
  faded-ink: "oklch(0.47 0.02 60)"
  rule: "oklch(0.8 0.012 85)"
  hairline: "oklch(0.875 0.008 85)"
  ochre-mark: "oklch(0.66 0.13 70)"
  ochre-ring: "oklch(0.62 0.12 70)"
  ochre-wash: "oklch(0.925 0.035 80)"
  ochre-wash-ink: "oklch(0.36 0.07 65)"
  ochre-rim-3d: "#C78F2E"
  eosin: "oklch(0.55 0.16 5)"
  eosin-soft: "oklch(0.94 0.03 5)"
  graphite: "oklch(0.185 0.006 70)"
  graphite-card: "oklch(0.215 0.006 70)"
  graphite-viewer: "oklch(0.16 0.006 70)"
  graphite-ink: "oklch(0.92 0.008 85)"
  graphite-faded-ink: "oklch(0.7 0.012 60)"
  graphite-rule: "oklch(0.42 0.012 60)"
  graphite-mark: "oklch(0.78 0.12 75)"
  graphite-eosin: "oklch(0.74 0.13 5)"
  tissue-bone: "#F0E6D2"
  tissue-muscle: "#A3433A"
  tissue-organ: "#C27D72"
  tissue-skin: "#C29B78"
typography:
  display-hero: { fontFamily: "Libre Caslon Display, Georgia, serif", fontSize: "68px", fontWeight: 400, lineHeight: 1.02, letterSpacing: "-0.02em" }
  display: { fontFamily: "Libre Caslon Display, Georgia, serif", fontSize: "34px", fontWeight: 400, lineHeight: 1.05, letterSpacing: "-0.01em" }
  headline: { fontFamily: "Libre Caslon Text, Georgia, serif", fontSize: "24px", fontWeight: 400, lineHeight: 1.33, letterSpacing: "-0.01em" }
  title: { fontFamily: "Libre Caslon Text, Georgia, serif", fontSize: "18px", fontWeight: 400, lineHeight: 1.55, letterSpacing: "-0.01em" }
  latin: { fontFamily: "Libre Caslon Text, Georgia, serif", fontSize: "inherit", fontWeight: 400, letterSpacing: "0" }
  body: { fontFamily: "Schibsted Grotesk, system-ui, sans-serif", fontSize: "0.95rem", fontWeight: 400, lineHeight: 1.65 }
  ui: { fontFamily: "Schibsted Grotesk, system-ui, sans-serif", fontSize: "14px", fontWeight: 400, lineHeight: 1.43 }
  label: { fontFamily: "Schibsted Grotesk, system-ui, sans-serif", fontSize: "0.6875rem", fontWeight: 600, letterSpacing: "0.08em" }
rounded:
  key: "1px"
  label: "2px"
  sm: "0.18rem"
  control: "3px"
  md: "0.24rem"
  lg: "0.3rem"
  full: "9999px"
spacing:
  gutter: "16px"
  gutter-wide: "24px"
  row: "16px"
  touch: "44px"
  strip: "48px"
  header: "56px"
components:
  button-primary: { backgroundColor: "{colors.press-ink}", textColor: "{colors.ink-on-press}", rounded: "{rounded.control}", padding: "0 24px", height: "48px" }
  button-primary-hover: { backgroundColor: "oklch(0.27 0.032 55 / 0.85)", textColor: "{colors.ink-on-press}" }
  rose-view: { backgroundColor: "{colors.viewer-ground}", textColor: "{colors.sepia-ink}", rounded: "{rounded.full}", size: "36px" }
  rose-view-active: { backgroundColor: "{colors.ochre-mark}", textColor: "oklch(0.22 0.03 55)", rounded: "{rounded.full}", size: "36px" }
  tree-item: { textColor: "{colors.sepia-ink}", rounded: "{rounded.control}", padding: "6px 8px" }
  tree-item-active: { backgroundColor: "{colors.ochre-wash}", textColor: "{colors.ochre-wash-ink}", rounded: "{rounded.control}", padding: "6px 8px" }
  leader-label: { backgroundColor: "oklch(0.938 0.007 85 / 0.9)", textColor: "{colors.sepia-ink}", rounded: "{rounded.label}", padding: "2px 6px" }
  pathology-tag: { backgroundColor: "{colors.eosin-soft}", textColor: "{colors.eosin}" }
  viewer-strip: { backgroundColor: "{colors.plate-paper}", height: "{spacing.strip}" }
---

# Design System: Vet Atlas

## Overview

**Creative North Star: "The Anatomical Plate"**

The viewer is an anatomical plate, not an app over a canvas. Every surface borrows from the printed atlas: warm plate paper and sepia ink, Caslon for names, Latin NAV terms in italic, hairline rules, roman-numbered indexes, figure captions under the specimen and leader lines from a structure to its name. The specimen carries the colour; the page around it stays ink on paper.

The signature interaction is dissection: one depth control peels the stack skin → muscles → organs → bones, and each layer can be shown, hidden or faded to an x-ray ghost. Content colours follow atlas convention per structure (the `color` in each content `meta.json`, falling back to its system colour), and the interface key (tree swatch, stack bar) repeats exactly that colour.

Density is study-grade: long sessions at a laptop, one-handed on a phone. Ornament is limited to what a plate already has.

**Key Characteristics:**
- Paper and ink neutrals; one ochre "mark" for what is selected, focused or active.
- Caslon Display for titles, Caslon Text for headings and Latin, Schibsted Grotesk for UI.
- Hairline rules divide; shadows and glass do not.
- Small, nearly square corners (2–4px).
- Matte tissue in a soft dissection-room light; depth from baked occlusion.

## Colors

Uncoated plate paper and sepia printing ink, warmed toward hue 55–85, with a graphite light table for dark mode; only the specimen and two reserved accents carry chroma.

### Primary
- **Ochre Mark** (ochre-mark, focus ring ochre-ring; graphite-mark in dark): the marker pen of the atlas. Selected rose view, active header tab and structure tab underline, the leader-line dot, text-selection wash, caret, focus rings, link underlines and hover underlines on index rows. In the scene the selection is an ochre rim light on the silhouette of the selected tissue (ochre-rim-3d) and hover tints tissue 20% toward it.
- **Ochre Wash** (ochre-wash with ochre-wash-ink): the active row of the structure tree and the "Studying" tag of the current layer.

### Secondary
- **Eosin** (eosin, eosin-soft; graphite-eosin in dark): pathology only. Pathology tags, the pathology badge on its page and the pathology icon in search.

### Neutral
- **Plate Paper** (plate-paper): page ground. **Plate Card** for the structure panel and popovers, **Plate Sidebar** for the dissection/tree column, **Viewer Ground** behind the specimen, a shade deeper than the page.
- **Sepia Ink** (sepia-ink) for text and the `ink` role; **Press Ink** (press-ink) for primary buttons; **Faded Ink** (faded-ink) for secondary text, hints, attribution and labels.
- **Rule** (rule) for structural section rules and the hero frame; **Hairline** (hairline) for row dividers, panel borders and inputs.
- **Graphite** set: the same roles on a warm graphite light table; borders become white at 11%.

### Tissue (content)
- Bone, muscle, organ and skin defaults (tissue-*) live in `content/species/*/systems/*.json`; structures override them per `meta.json`. They are data, not UI accents.

**The One Mark Rule.** Ochre means "this one": selection, focus, active state and link underlines. It never decorates, never fills a resting surface, never signals warning.

**The Eosin Rule.** Eosin pink is reserved for pathology, as in a stained slide. Nothing else in the interface chrome may be pink-red; the `destructive` token shares its hue and is held for form errors (none ship today). Tissue colours are content and exempt.

**The No Violet Rule.** No violet, indigo or purple anywhere, including charts and focus states.

## Typography

**Display Font:** Libre Caslon Display (Georgia, serif), weight 400 only
**Heading / Latin Font:** Libre Caslon Text (Georgia, serif), 400/700, roman and italic
**Body / UI Font:** Schibsted Grotesk (system-ui, sans-serif)

**Character:** classic atlas Caslon for every name a student must learn, a sturdy grotesk for everything they operate. All loaded via `next/font`, no external CDN.

### Hierarchy
- **Display hero** (400, 68px desktop → 56px sm → 44px phone, 1.02): the home frontispiece title only.
- **Display** (400, 28–44px, 1.0–1.05): page titles: species 44px, structure 34px, system 32px, piece view 28px. Always `ink`.
- **Headline** (Caslon Text 400, 24px): entries in the roman species index and the dissection stack.
- **Title** (Caslon Text 400, 16–18px): section headings in panels; region headings in italic.
- **Latin** (Caslon Text italic, letter-spacing 0): every NAV and scientific name, marked `lang="la"`, beside or under the vernacular.
- **Body** (Grotesk 400, 0.95rem, 1.65, max 68ch): MDX long-form; `em` switches to Caslon italic, h2 gets a hairline above.
- **UI** (Grotesk, 14px; 11–12px for hints, counts, attribution).
- **Plate label** (Grotesk 600, 11px, 0.08em, uppercase, faded ink): figure and region names, view names, section labels.

**The Latin Italic Rule.** A Latin term is always Caslon italic and always accompanies the vernacular, never replaces it.

**The Plate Label Rule.** The small-caps plate label is the label itself (a section name, a region, a definition term, a caption line). It never sits as a kicker or eyebrow above another heading.

**The Tabular Rule.** Counts, percentages and opacity values use tabular figures.

## Layout

- **Pages:** centred column, 1180px (home) or 1100px (species), 16px gutter on phones and 24px from `sm`. Header is a sticky 56px bar, max 1600px. Lists are ruled rows (16px vertical padding) with a hairline under each, not cards.
- **Frontispiece:** title and lead left (6fr), the orbiting specimen as a framed figure right (5fr) with an italic caption beneath; under a rule, the roman-numbered species index (I, II…) with upcoming species in faded ink.
- **Viewer (lg+):** three columns: 288px dissection + structure tree, the specimen, and a 360–420px structure panel; full viewport minus header. A docked footer strip (48px) under the specimen holds isolate, explode and dim controls.
- **Viewer (below lg):** the specimen takes min(62dvh, 600px) with the structure panel below. The tree opens in a left sheet; the footer strip becomes a touch strip with 44px targets: a native select for the six anatomical views, a "Dissection" button opening the dissection panel in a bottom sheet, isolate, a settings popover with sliders, reset and deselect.
- **Orientation rose:** desktop only (140px, top-right of the plate). Phones use the native select instead.
- **Plate legend:** top-left of the scene, species · system as a plate label with the current view in Caslon italic; attribution in 11px along the bottom edge.

## Elevation & Depth

The interface is flat. Separation comes from ground shifts (paper, card, sidebar, viewer ground) and hairline rules. The only depth is the specimen's.

**The Hairline Rule.** Divide with a 1px rule or hairline, never a drop shadow. No glass, no backdrop blur, no translucent floating panels over the scene.

### In the scene
- **Lighting:** built in-scene, offline (no HDR download): a large overhead softbox, a dim warm fill, a cool back fill and a floor bounce as lightformers, plus a hemisphere light (#fbf7f0 / #6f675d, 0.55) and one key directional light (0.9). Broad and low-contrast.
- **Tone mapping:** Neutral, so tissue colours stay true to the content values.
- **Finishes:** matte, metalness 0. Bone roughness 0.86; muscle 0.72 with soft sheen; organ 0.6 with a faint 0.06 clearcoat; skin 0.9 velvet sheen.
- **Occlusion:** ambient occlusion baked into vertex colours carries the form, not reflections.
- **Selection:** an ochre rim light in the tissue shader itself, strongest at grazing angles. No extra hull geometry, so nothing shows through eye sockets or the open mouth.
- **Skin:** no fur. The skin is a see-through silhouette (ghost at 40%) by default, so studying the integumentary system also shows the skeleton inside; eyes, claws, hooves and horns stay solid. "Opaque skin" in the skin row of the dissection panel draws it solid; a selected skin piece is always solid.
- **Ghost:** a faded layer turns x-ray: faces toward the viewer drop to 18% of its opacity while the silhouette holds and lightens slightly, so inner layers read through a readable outline. Layers under 50% let clicks pass through.
- **Contact shadow:** a soft floor shadow (0.38 opacity) grounds the specimen; omitted in the piece view.

**The Matte Specimen Rule.** No glossy, metallic or glinting tissue. Depth reads from colour and baked occlusion.

## Shapes

Nearly square: 2–4px corners on controls, rows and labels (base radius 0.3rem; the primary CTA and tree rows 3px; the leader label 2px; colour keys 1–2px). Circles appear only where the plate's instruments are round: the orientation rose's view discs and the slider thumb. The brand tile is the one soft square (22% corner) because it doubles as the app icon.

## Components

### Buttons
- **Primary:** press-ink fill, 48px tall, 24px padding, 3px corners, trailing arrow; hover lightens to 85%. One per surface (the frontispiece CTA).
- **Outline / ghost:** shadcn variants on hairline borders for secondary actions; ghost for icon actions in the footer strip.

### Orientation Rose
A compass on the plate: ring and 30° ticks in 40% ink, needles toward dorsal/ventral/cranial/caudal. Caslon letters in 36px discs on viewer ground; lateral left/right pair in the centre. Active view = ochre disc, bold dark ink. Keys 1–6; a hand orbit clears the active view.

### Dissection Panel
Plate-label heading, one-line hint, a depth slider with the four layer names as stops, then one ruled row per layer: a 6px colour bar in the layer colour, name, "Studying" tag or a link to study that layer, opacity percentage, eye toggle, and a per-layer opacity slider when visible. Keys `[` `]` peel.

### Structure Tree
Region plate labels, rows with a 10px tissue swatch (1px ink/15 border), vernacular name and Latin italic beneath. Hover syncs with the model; active row = ochre wash.

### Leader Label
In-scene label: a 1px ink leader line with an ochre dot at the structure, name (14px semibold) and Latin (13px italic) on a 90% viewer-ground patch with 2px corners. No shadow.

### Plate Caption and Indexes
Figures carry an italic Caslon caption ("Plate I — …"); indexes are roman-numbered ruled rows whose title gains an ochre underline on hover.

### Brand Mark
The lateral silhouette of the atlas's own scanned dog skull and mandible, traced by `scripts/build-brand.ts` from `public/models/dog/skeletal.glb` into `mark-path.ts`, `app/icon.svg` and `app/apple-icon.png`. `Logo`: bone (page ground) on a sepia-ink tile, 32px in the header beside the Caslon Display wordmark. `Mark`: bare skull in `currentColor`, used in the footer at 80% ink. Regenerate with `pnpm brand`; never hand-draw or substitute a generic glyph.

### Tags and Notices
Pathology tags are eosin on eosin-soft. Draft review and placeholder/illustrative notices are faded ink on plate-muted; they stay visible.

## Do's and Don'ts

### Do:
- **Do** use ochre only for selection, focus, active state and link underlines; selection in 3D is the ochre rim light, never a recolour of the tissue.
- **Do** colour structures from content `meta.json` / system `color`, and repeat that exact colour in every key.
- **Do** show the Latin NAV name in Caslon italic next to every vernacular name.
- **Do** separate with hairlines and ground shifts; keep corners at 2–4px.
- **Do** keep 44px touch targets below lg, keyboard shortcuts and visible focus rings, and respect `prefers-reduced-motion` (camera moves snap, hero orbit stops, transitions collapse).
- **Do** keep the scene matte, Neutral-tone-mapped and lit in-scene so it works offline.

### Don't:
- **Don't** use ochre for warnings, decoration or resting fills.
- **Don't** use eosin or any pink-red chrome outside pathology, or any violet at all.
- **Don't** add drop shadows, glass, backdrop blur or translucent panels over the specimen.
- **Don't** put kicker or eyebrow labels above headings.
- **Don't** give tissue gloss, metalness or environment reflections.
- **Don't** wrap rows in cards; a plate lists, it does not tile.
