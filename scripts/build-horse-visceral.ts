/**
 * Builds public/models/horse/visceral.glb: the horse's organs, placed inside
 * the skeleton of public/models/horse/skeletal.glb (build that first).
 *
 * Sources (downloaded once into .cache/models/):
 * - "Heart (horse) Plastinated" by the Veterinary Faculty of the University
 *   of Sarajevo, Sketchfab, CC BY 4.0: photogrammetry of a plastinated heart
 *   with the stumps of the great vessels (base up).
 * - "Horse Stomach-4" by shiftstudio, Sketchfab, CC BY 4.0: a sculpted
 *   stomach with the end of the esophagus and the start of the duodenum
 *   (both stumps point to +z of the model, the blind sac is +y).
 * - "Equine Colon" by OVCanatomy (Ontario Veterinary College; modeled by
 *   Joshua Antunes), Sketchfab, CC BY 4.0: the ascending (large) colon, its
 *   two stacked horseshoes open towards +x of the model (the pelvic flexure
 *   at -y, the start of the right ventral colon at +y, the ventral layer at
 *   -z).
 *
 * scripts/ct/horse_visceral.py places them and models every other organ from
 * skeletal landmarks (fidelity "illustrative"); this script exports the
 * inputs, runs it and writes the GLB.
 *
 * Output conventions as in scripts/lib/glb.ts: metres, Y up, animal faces -Z,
 * left side -X.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Matrix4 } from "three";
import { meshKey } from "../lib/content/mesh";
import { CACHE_DIR, bake, bounds, createModel, download, readAtlas, readPrims, transform, type Geometry } from "./lib/glb";
import { weldSimplify } from "./lib/segment";

const SKELETON = path.join(process.cwd(), "public", "models", "horse", "skeletal.glb");
const OUT = path.join(process.cwd(), "public", "models", "horse", "visceral.glb");
const WORK = path.join(CACHE_DIR, "horse-visceral");
const PYTHON = path.join(process.cwd(), ".venv", "bin", "python");

const sources = {
  heart: { uid: "fce338c614f44b5aae3ddd38226b97b7", file: "unsa-horse-heart.glb" },
  stomach: { uid: "f0be7126022941999d4232e27bcbf477", file: "shiftstudio-horse-stomach.glb" },
  colon: { uid: "b89f51941d4e4b67a73639f3c810ad96", file: "ovc-equine-colon.glb" },
};

// Triangle budget per mesh id (the whole file stays under 4 MB).
const meshes: Record<string, number> = {
  "horse.visceral.brain.cerebrum": 16000,
  "horse.visceral.brain.cerebellum": 5000,
  "horse.visceral.brain.brainstem": 2500,
  "horse.visceral.heart": 30000,
  "horse.visceral.great-vessels": 8000,
  "horse.visceral.lungs.L": 16000,
  "horse.visceral.lungs.R": 16000,
  "horse.visceral.trachea": 5000,
  "horse.visceral.esophagus": 4000,
  "horse.visceral.stomach": 12000,
  "horse.visceral.liver": 14000,
  "horse.visceral.pancreas": 3000,
  "horse.visceral.spleen": 5000,
  "horse.visceral.small-intestine": 30000,
  "horse.visceral.cecum": 12000,
  "horse.visceral.large-colon": 40000,
  "horse.visceral.small-colon": 20000,
  "horse.visceral.kidneys.L": 5000,
  "horse.visceral.kidneys.R": 5000,
  "horse.visceral.urinary-bladder": 3000,
  "horse.visceral.uterus": 6000,
  "horse.visceral.ovaries.L": 1200,
  "horse.visceral.ovaries.R": 1200,
  "horse.visceral.thyroid": 1500,
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

// A scan centred on its bounding box and scaled to metres (`k` per unit).
async function scan(source: { uid: string; file: string }, k: number, tris: number) {
  const g = bake(await readPrims(await download(source)), new Matrix4());
  const b = bounds(g);
  return weldSimplify(transform(g, new Matrix4().makeScale(k, k, k).multiply(new Matrix4().makeTranslation(-b.center.x, -b.center.y, -b.center.z))), tris);
}

fs.mkdirSync(WORK, { recursive: true });
writeBin(path.join(WORK, "heart"), new Map([["heart", await scan(sources.heart, 0.001, 200_000)]]));
writeBin(path.join(WORK, "stomach"), new Map([["stomach", await scan(sources.stomach, 0.01, 100_000)]]));
writeBin(path.join(WORK, "colon"), new Map([["colon", await scan(sources.colon, 0.2, 200_000)]]));
writeBin(path.join(WORK, "skeleton"), await readAtlas(SKELETON));

execFileSync(PYTHON, ["-I", path.join("scripts", "ct", "horse_visceral.py"), WORK], { stdio: "inherit" });

const organs = readBin(path.join(WORK, "organs"));
const model = createModel("horse.visceral", [0.79, 0.56, 0.53, 1]);
for (const [id, tris] of Object.entries(meshes)) {
  const g = organs.get(id);
  if (!g) throw new Error(`horse_visceral.py produced no mesh for ${id}`);
  model.add(meshKey(id), g, tris);
}
await model.write(OUT);
