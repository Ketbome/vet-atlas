# Models

## Conventions

- Units: metres. Y up. The animal faces **-Z**; its left side is **-X**.
- One GLB per species and system: `models/dist/<species>/<system>.glb`.
  During development it is copied to `public/models/…`; in production it is
  served from object storage (Cloudflare R2).
- Every mesh is one structure. Name = structure id with `.` replaced by `_`,
  plus `_L` / `_R` for paired structures: `dog_skeletal_femur_L`.
- No textures on bones; the viewer colours them. Keep materials simple.
- Budget: ≤ 600k triangles for a full skeleton. Decimate in Blender.

## Pipeline

1. Download the source model and add it to `manifest.json` (source id from
   `content/sources.json`, license, author, URL, date).
2. Import into `models/src/<species>.blend` (tracked with Git LFS).
   Normalise scale, orientation and origin; rename objects.
3. Export GLB (Blender: glTF 2.0, "Selected objects", +Y up, no animation).
4. Compress: `npx gltf-transform meshopt in.glb out.glb` (needs the
   `meshoptimizer` package) or leave uncompressed while under ~10 MB.
5. `pnpm validate` cross-checks mesh names against `content/`.

## Sources

- **Dog skeleton**: LMU Munich, vetanatMunich on Sketchfab. Check each model's
  license page; only CC BY models go in.
- **Cat skeleton** (planned): MorphoSource CT series. Non-commercial;
  derivatives must be archived back on MorphoSource.
- **Placeholder**: `scripts/build-placeholder-model.ts` generates schematic
  capsules so the viewer works before real scans are integrated. Systems using
  it carry `"placeholder": true` and the UI shows a warning.
