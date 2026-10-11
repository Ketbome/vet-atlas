/**
 * Builds public/models/dog/visceral.glb: the dog's organs, placed inside the
 * skeleton of public/models/dog/skeletal.glb (build that first).
 *
 * Sources (downloaded once into .cache/models/):
 * - "3D Canine Anatomy: Normal Abdomen" (pixelbeaker, CC BY 4.0): CT
 *   segmentation of one dog from the caudal thorax to the hips. Liver,
 *   stomach (fundus and body), kidneys, abdominal aorta and the caudal part
 *   of the lungs come from it; the space its intestinal loops fill shapes
 *   the modelled small intestine. Its rib cage and vertebrae are only used to
 *   register the organs to our skeleton.
 * - "Normal Canine Heart Anatomy" (pixelbeaker, CC BY 4.0): CT segmentation
 *   of the heart and the great vessels of a large-breed dog, split into the
 *   heart, aorta, venae cavae, pulmonary trunk and arteries, and pulmonary
 *   veins.
 * - "Cortical Atlas of the Canine Brain" (Johnson & Barry 2019, CC0): MRI
 *   population template, meshed by scripts/ct/brain.py.
 *
 * The geometry work (voxel clean-up of the CT surfaces, registration to the
 * skeleton, the cranial half of the lungs, procedural organs) happens in
 * scripts/ct/visceral.py; this script exports the inputs for it, runs it and
 * writes the GLB. See that file for the registration and modelling details.
 *
 * Output conventions as in scripts/lib/glb.ts: metres, Y up, animal faces -Z,
 * left side -X. Paired organs keep their own left and right scans (kidneys,
 * lungs), because they are not mirror images of each other.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Matrix4 } from "three";
import { meshKey } from "../lib/content/mesh";
import { CACHE_DIR, bake, createModel, download, io, readAtlas, type Geometry } from "./lib/glb";

const SKELETON = path.join(process.cwd(), "public", "models", "dog", "skeletal.glb");
const OUT = path.join(process.cwd(), "public", "models", "dog", "visceral.glb");
const WORK = path.join(CACHE_DIR, "visceral");
const PYTHON = path.join(process.cwd(), ".venv", "bin", "python");

const sources = {
  abdomen: { uid: "962de878d2e94b75b10075931f0edaa3", file: "pixelbeaker-canine-abdomen.glb" },
  heart: { uid: "5b4dec17040248948059e998b46f0b86", file: "pixelbeaker-canine-heart.glb" },
};

// Triangle budget per mesh id (the whole file stays well under 4 MB).
const meshes: Record<string, number> = {
  "dog.visceral.brain.cerebrum": 24000,
  "dog.visceral.brain.cerebellum": 8000,
  "dog.visceral.brain.brainstem": 3000,
  "dog.visceral.heart": 30000,
  "dog.visceral.aorta": 16000,
  "dog.visceral.venae-cavae": 8000,
  "dog.visceral.pulmonary-trunk": 12000,
  "dog.visceral.pulmonary-veins": 8000,
  "dog.visceral.lungs.L": 18000,
  "dog.visceral.lungs.R": 18000,
  "dog.visceral.trachea": 4000,
  "dog.visceral.esophagus": 3000,
  "dog.visceral.stomach": 9000,
  "dog.visceral.liver": 26000,
  "dog.visceral.pancreas": 3000,
  "dog.visceral.small-intestine": 24000,
  "dog.visceral.large-intestine": 5000,
  "dog.visceral.spleen": 2000,
  "dog.visceral.kidneys.L": 6500,
  "dog.visceral.kidneys.R": 6500,
  "dog.visceral.urinary-bladder": 3000,
  "dog.visceral.prostate": 1000,
  "dog.visceral.thyroid.L": 600,
  "dog.visceral.thyroid.R": 600,
};

type Entry = { name: string; kind: "position" | "index"; offset: number; count: number };

// Same layout as scripts/ct/*.py: <base>.json index + <base>.bin of float32
// positions and uint32 indices.
function writeBin(base: string, parts: Map<string, Geometry>) {
  const index: Entry[] = [];
  const chunks: Buffer[] = [];
  let offset = 0;
  for (const [name, g] of parts) {
    for (const [kind, a] of [["position", g.position], ["index", g.index]] as const) {
      index.push({ name, kind, offset, count: a.length });
      chunks.push(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
      offset += a.byteLength;
    }
  }
  fs.writeFileSync(`${base}.bin`, Buffer.concat(chunks));
  fs.writeFileSync(`${base}.json`, JSON.stringify(index));
}

function readBin(base: string) {
  const index = JSON.parse(fs.readFileSync(`${base}.json`, "utf8")) as Entry[];
  const buf = fs.readFileSync(`${base}.bin`);
  const out = new Map<string, Partial<Geometry>>();
  for (const e of index) {
    const bytes = buf.buffer.slice(buf.byteOffset + e.offset, buf.byteOffset + e.offset + e.count * 4);
    const g = out.get(e.name) ?? {};
    if (e.kind === "position") g.position = new Float32Array(bytes);
    else g.index = new Uint32Array(bytes);
    out.set(e.name, g);
  }
  return out as Map<string, Geometry>;
}

// One entry per source node, in the source file's own frame and units.
async function exportSource(file: string, base: string, merged: boolean) {
  const doc = await io.read(file);
  const parts = new Map<string, Geometry>();
  const nodes = doc.getRoot().listNodes().filter((n) => n.getMesh());
  const prims = (n: (typeof nodes)[number]) => n.getMesh()!.listPrimitives().map((prim) => ({ prim, world: new Matrix4().fromArray(n.getWorldMatrix()) }));
  if (merged) parts.set("all", bake(nodes.flatMap(prims), new Matrix4()));
  else for (const n of nodes) parts.set(n.getName(), bake(prims(n), new Matrix4()));
  writeBin(base, parts);
}

fs.mkdirSync(WORK, { recursive: true });
await exportSource(await download(sources.abdomen), path.join(WORK, "abdomen"), false);
await exportSource(await download(sources.heart), path.join(WORK, "heart"), true);
writeBin(path.join(WORK, "skeleton"), await readAtlas(SKELETON));

const run = (script: string, ...args: string[]) => execFileSync(PYTHON, ["-I", path.join("scripts", "ct", script), ...args], { stdio: "inherit" });
run("brain.py", path.join(WORK, "brain"));
run("visceral.py", WORK);

const organs = readBin(path.join(WORK, "organs"));
const model = createModel("dog.visceral", [0.79, 0.56, 0.53, 1]);
for (const [id, tris] of Object.entries(meshes)) {
  const g = organs.get(id);
  if (!g) throw new Error(`visceral.py produced no mesh for ${id}`);
  model.add(meshKey(id), g, tris);
}
await model.write(OUT);
