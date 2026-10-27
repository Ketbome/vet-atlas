import { z } from "zod";

export const localeText = z.record(z.string(), z.string());

// draft: unchecked. sourced: every claim checked against the cited references,
// no veterinarian has signed it yet. reviewed: signed by a veterinary reviewer.
export const reviewSchema = z.object({
  status: z.enum(["draft", "sourced", "reviewed"]),
  by: z.string().optional(),
  date: z.string().optional(),
});

export const referenceSchema = z.object({
  title: z.string(),
  url: z.string().url().optional(),
  year: z.number().int().optional(),
});

export const cameraPresets = [
  "lateral-left",
  "lateral-right",
  "dorsal",
  "ventral",
  "cranial",
  "caudal",
] as const;
export const cameraPreset = z.enum(cameraPresets);

export const speciesSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  scientificName: z.string(),
  name: localeText,
  status: z.enum(["draft", "published"]),
  systems: z.array(z.string()),
});

export const materials = ["bone", "muscle", "organ", "skin"] as const;

export const systemSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/),
  species: z.string(),
  slug: z.string(),
  name: localeText,
  status: z.enum(["draft", "published"]),
  model: z.object({
    file: z.string(),
    source: z.string(),
    placeholder: z.boolean().default(false),
  }),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  // Depth in the dissection stack: 0 is the most superficial layer.
  order: z.number().int().min(0),
  material: z.enum(materials),
  regions: z.array(z.object({ id: z.string(), name: localeText })),
});

export const structureSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/),
  system: z.string(),
  nav: z.string(),
  region: z.string(),
  laterality: z.enum(["paired", "single"]),
  meshes: z.array(z.string()).min(1),
  fidelity: z.enum(["scan", "modeled", "illustrative"]).default("scan"),
  // Overrides the system colour in the viewer (e.g. dark eyes on the skin).
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  material: z.enum(materials).optional(),
  source: z.string().optional(),
  camera: z
    .object({
      preset: cameraPreset.default("lateral-left"),
      zoom: z.number().positive().default(1),
    })
    .default({ preset: "lateral-left", zoom: 1 }),
  pathologies: z.array(z.string()).default([]),
  media: z.array(z.string()).default([]),
  related: z.array(z.string()).default([]),
  references: z.array(referenceSchema).default([]),
  review: reviewSchema,
});

export const pathologyCategories = [
  "congenital",
  "degenerative",
  "traumatic",
  "neoplastic",
  "infectious",
  "metabolic",
  "inflammatory",
] as const;

export const pathologySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  category: z.enum(pathologyCategories),
  species: z.array(z.string()).min(1),
  structures: z.array(z.string()).min(1),
  media: z.array(z.string()).default([]),
  references: z.array(referenceSchema).default([]),
  review: reviewSchema,
});

export const mediaTypes = ["photo", "histology", "radiograph", "ct", "illustration"] as const;

export const mediaSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  type: z.enum(mediaTypes),
  url: z.string().url(),
  source: z.string(),
  license: z.string(),
  attribution: z.string(),
  caption: localeText.optional(),
  stain: z.string().optional(),
  magnification: z.number().positive().optional(),
});

export const sourceSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string(),
  url: z.string().url(),
  license: z.string(),
  licenseUrl: z.string().url().optional(),
  conditions: z.object({
    commercial: z.boolean(),
    derivatives: z.boolean(),
    archiveDerivatives: z.boolean().default(false),
  }),
  notes: z.string().optional(),
});

export const frontmatterSchema = z.object({
  title: z.string(),
  summary: z.string(),
});

export type Species = z.infer<typeof speciesSchema>;
export type System = z.infer<typeof systemSchema>;
export type Structure = z.infer<typeof structureSchema>;
export type Pathology = z.infer<typeof pathologySchema>;
export type Media = z.infer<typeof mediaSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Frontmatter = z.infer<typeof frontmatterSchema>;
export type Reference = z.infer<typeof referenceSchema>;
export type CameraPreset = z.infer<typeof cameraPreset>;
export type PathologyCategory = (typeof pathologyCategories)[number];
