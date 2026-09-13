/**
 * Cross-checks content integrity: references between entities, MDX docs per
 * locale, and mesh names inside each system's GLB. Exit code 1 on any error.
 */
import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { loadContent, readDoc } from "../lib/content/load";
import { meshKey } from "../lib/content/mesh";

const errors: string[] = [];
const warnings: string[] = [];
const db = loadContent();

const speciesIds = new Set(db.species.map((s) => s.id));
const systemIds = new Set(db.systems.map((s) => s.id));
const structureIds = new Set(db.structures.map((s) => s.id));
const pathologyIds = new Set(db.pathologies.map((p) => p.id));
const mediaIds = new Set(db.media.map((m) => m.id));
const sourceIds = new Set(db.sources.map((s) => s.id));

for (const sp of db.species) {
  for (const sys of sp.systems) if (!systemIds.has(sys)) errors.push(`species ${sp.id}: unknown system ${sys}`);
}

for (const sys of db.systems) {
  if (!speciesIds.has(sys.species)) errors.push(`system ${sys.id}: unknown species ${sys.species}`);
  if (!sourceIds.has(sys.model.source)) errors.push(`system ${sys.id}: unknown model source ${sys.model.source}`);
  if (!sys.id.startsWith(`${sys.species}.`)) errors.push(`system ${sys.id}: id must start with species id`);
}

for (const s of db.structures) {
  const sys = db.systems.find((x) => x.id === s.system);
  if (!sys) {
    errors.push(`structure ${s.id}: unknown system ${s.system}`);
  } else {
    if (!s.id.startsWith(`${sys.id}.`)) errors.push(`structure ${s.id}: id must start with ${sys.id}`);
    if (!sys.regions.some((r) => r.id === s.region)) errors.push(`structure ${s.id}: unknown region ${s.region}`);
  }
  if (path.basename(s.dir) !== s.id.split(".")[2]) errors.push(`structure ${s.id}: folder name must be ${s.id.split(".")[2]}`);
  for (const m of s.meshes) if (!m.startsWith(s.id)) errors.push(`structure ${s.id}: mesh ${m} must start with the structure id`);
  for (const p of s.pathologies) if (!pathologyIds.has(p)) errors.push(`structure ${s.id}: unknown pathology ${p}`);
  for (const m of s.media) if (!mediaIds.has(m)) errors.push(`structure ${s.id}: unknown media ${m}`);
  for (const r of s.related) if (!structureIds.has(r)) errors.push(`structure ${s.id}: unknown related ${r}`);
  for (const locale of ["es", "en"]) {
    if (!fs.existsSync(path.join(s.dir, `${locale}.mdx`))) warnings.push(`structure ${s.id}: missing ${locale}.mdx`);
  }
  if (!readDoc(s.dir, "en")) errors.push(`structure ${s.id}: no MDX document in any locale`);
}

for (const p of db.pathologies) {
  for (const sp of p.species) if (!speciesIds.has(sp)) errors.push(`pathology ${p.id}: unknown species ${sp}`);
  for (const s of p.structures) if (!structureIds.has(s)) errors.push(`pathology ${p.id}: unknown structure ${s}`);
  for (const m of p.media) if (!mediaIds.has(m)) errors.push(`pathology ${p.id}: unknown media ${m}`);
  if (path.basename(p.dir) !== p.id) errors.push(`pathology ${p.id}: folder name must be ${p.id}`);
  for (const locale of ["es", "en"]) {
    if (!fs.existsSync(path.join(p.dir, `${locale}.mdx`))) warnings.push(`pathology ${p.id}: missing ${locale}.mdx`);
  }
  if (!readDoc(p.dir, "en")) errors.push(`pathology ${p.id}: no MDX document in any locale`);
}

for (const m of db.media) {
  if (!sourceIds.has(m.source)) errors.push(`media ${m.id}: unknown source ${m.source}`);
  if (m.type === "histology" && !m.stain) warnings.push(`media ${m.id}: histology without stain`);
}

const io = new NodeIO();
for (const sys of db.systems) {
  const file = path.join(process.cwd(), "public", sys.model.file);
  if (!fs.existsSync(file)) {
    errors.push(`system ${sys.id}: model file ${sys.model.file} not found`);
    continue;
  }
  const doc = await io.read(file);
  const meshNames = new Set(doc.getRoot().listNodes().filter((n) => n.getMesh()).map((n) => n.getName()));
  const expected = new Map<string, string>();
  for (const s of db.structures.filter((x) => x.system === sys.id)) {
    for (const m of s.meshes) expected.set(meshKey(m), s.id);
  }
  for (const [key, sid] of expected) {
    if (!meshNames.has(key)) errors.push(`structure ${sid}: mesh ${key} not found in ${sys.model.file}`);
  }
  for (const name of meshNames) {
    if (!expected.has(name)) warnings.push(`model ${sys.model.file}: mesh ${name} has no structure entry`);
  }
}

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);
console.log(
  `${db.species.length} species, ${db.systems.length} systems, ${db.structures.length} structures, ${db.pathologies.length} pathologies, ${db.media.length} media, ${db.sources.length} sources`,
);
if (errors.length) {
  console.error(`${errors.length} error(s)`);
  process.exit(1);
}
console.log("content ok");
