/**
 * Builds public/models/cat/visceral.glb: the cat's organs, placed inside the
 * skeleton of public/models/cat/skeletal.glb (build that first).
 *
 * Sources (downloaded once into .cache/models/):
 * - "Normal Feline Anatomy – Digestive System" (pixelbeaker, CC BY 4.0): CT
 *   segmentation of one cat in millimetres, one material per tissue (Skin,
 *   Blood_Volume, Liver, Intestines, Pancreas, Stomach, Kidneys, Bladder).
 *   Liver, stomach, pancreas, small and large intestine, kidneys, urinary
 *   bladder and the abdominal great vessels come from it; its skin is only
 *   used to register the organs to our skeleton.
 * - "Diffusion Tensor Imaging White Matter Atlas for the Domestic Feline"
 *   (Johnson et al. 2019, Cornell eCommons, CC0): MRI population template,
 *   meshed by scripts/ct/cat_brain.py.
 *
 * The geometry work (voxel clean-up of the CT surfaces, registration to the
 * skeleton, procedural thoracic and cervical organs) happens in
 * scripts/ct/cat_visceral.py; this script exports the inputs for it, runs it
 * and writes the GLB. See that file for the registration and modelling details.
 *
 * Output conventions as in scripts/lib/glb.ts: metres, Y up, animal faces -Z,
 * left side -X.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Matrix4 } from "three";
import { meshKey } from "../lib/content/mesh";
import { CACHE_DIR, bake, createModel, download, io, readAtlas, type Geometry } from "./lib/glb";

const SKELETON = path.join(process.cwd(), "public", "models", "cat", "skeletal.glb");
const OUT = path.join(process.cwd(), "public", "models", "cat", "visceral.glb");
const WORK = path.join(CACHE_DIR, "cat-visceral");
const PYTHON = path.join(process.cwd(), ".venv", "bin", "python");

const source = { uid: "ab92a2a9d9024447b0ed4c080ad17106", file: "pixelbeaker-feline-digestive.glb" };

// Triangle budget per mesh id (the whole file stays under 4 MB).
const meshes: Record<string, number> = {
  "cat.visceral.brain.cerebrum": 20000,
  "cat.visceral.brain.cerebellum": 7000,
  "cat.visceral.brain.brainstem": 3000,
  "cat.visceral.heart": 10000,
  "cat.visceral.great-vessels": 12000,
  "cat.visceral.lungs.L": 16000,
  "cat.visceral.lungs.R": 16000,
  "cat.visceral.trachea": 4000,
  "cat.visceral.esophagus": 3000,
  "cat.visceral.stomach": 10000,
  "cat.visceral.liver": 24000,
  "cat.visceral.pancreas": 5000,
  "cat.visceral.small-intestine": 45000,
  "cat.visceral.large-intestine": 9000,
  "cat.visceral.spleen": 6000,
  "cat.visceral.kidneys.L": 5000,
  "cat.visceral.kidneys.R": 5000,
  "cat.visceral.urinary-bladder": 4000,
  "cat.visceral.prostate": 1000,
  "cat.visceral.thyroid.L": 600,
  "cat.visceral.thyroid.R": 600,
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

// One entry per source node, named "<material>/<node>", in the source frame (mm).
async function exportSource(file: string, base: string) {
  const doc = await io.read(file);
  const parts = new Map<string, Geometry>();
  for (const n of doc.getRoot().listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    const prims = mesh.listPrimitives().map((prim) => ({ prim, world: new Matrix4().fromArray(n.getWorldMatrix()) }));
    parts.set(`${prims[0].prim.getMaterial()?.getName() ?? "none"}/${n.getName()}`, bake(prims, new Matrix4()));
  }
  writeBin(base, parts);
}

fs.mkdirSync(WORK, { recursive: true });
await exportSource(await download(source), path.join(WORK, "source"));
writeBin(path.join(WORK, "skeleton"), await readAtlas(SKELETON));

const run = (script: string, ...args: string[]) => execFileSync(PYTHON, ["-I", path.join("scripts", "ct", script), ...args], { stdio: "inherit" });
run("cat_brain.py", path.join(WORK, "brain"));
run("cat_visceral.py", WORK);

const organs = readBin(path.join(WORK, "organs"));
const model = createModel("cat.visceral", [0.79, 0.56, 0.53, 1]);
for (const [id, tris] of Object.entries(meshes)) {
  const g = organs.get(id);
  if (!g) throw new Error(`cat_visceral.py produced no mesh for ${id}`);
  model.add(meshKey(id), g, tris);
}
await model.write(OUT);
