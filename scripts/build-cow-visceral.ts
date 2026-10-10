/**
 * Builds public/models/cow/visceral.glb: the cow's organs, placed inside the
 * skeleton of public/models/cow/skeletal.glb (build that first).
 *
 * Sources (downloaded once into .cache/models/):
 * - "Bovine Rumen" by OVCanatomy (Ontario Veterinary College; modeled by
 *   Joshua Antunes), Sketchfab, CC BY 4.0: a fixed bovine stomach, one fused
 *   surface with windows cut into the rumen, omasum and abomasum. It is cut
 *   into rumen, reticulum, omasum and abomasum here with the watershed of
 *   scripts/lib/segment.ts (seeds on renders of the model: +z is cranial, the
 *   cardia is the stump on the cranial face, the omasum the ball on the right
 *   of the reticulum and the abomasum the tube from it to the pylorus, ventral
 *   and to the right). The cardia goes with the reticulum, the duodenal stump
 *   with the abomasum.
 * - "Whole Cow Heart Fixed" by Visible Heart Lab (University of Minnesota),
 *   Sketchfab, CC BY 4.0: Artec scan of a perfusion-fixed bovine heart (mm,
 *   base up). Its roll about the long axis is not known from the scan.
 *
 * scripts/ct/cow_visceral.py places them and models every other organ from
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
import { Surface, weldSimplify, type Pick } from "./lib/segment";

const SKELETON = path.join(process.cwd(), "public", "models", "cow", "skeletal.glb");
const OUT = path.join(process.cwd(), "public", "models", "cow", "visceral.glb");
const WORK = path.join(CACHE_DIR, "cow-visceral");
const PYTHON = path.join(process.cwd(), ".venv", "bin", "python");

const sources = {
  stomach: { uid: "ec58bb93101448349c4551c89a41429c", file: "ovc-bovine-rumen.glb" },
  heart: { uid: "c49f873ba4be4193b880bdf624957dc4", file: "vhl-cow-heart.glb" },
};

// Triangle budget per mesh id (the whole file stays under 4 MB).
const meshes: Record<string, number> = {
  "cow.visceral.brain.cerebrum": 16000,
  "cow.visceral.brain.cerebellum": 5000,
  "cow.visceral.brain.brainstem": 2500,
  "cow.visceral.heart": 30000,
  "cow.visceral.great-vessels": 8000,
  "cow.visceral.lungs.L": 16000,
  "cow.visceral.lungs.R": 18000,
  "cow.visceral.trachea": 5000,
  "cow.visceral.esophagus": 4000,
  "cow.visceral.rumen": 40000,
  "cow.visceral.reticulum": 12000,
  "cow.visceral.omasum": 10000,
  "cow.visceral.abomasum": 10000,
  "cow.visceral.liver": 14000,
  "cow.visceral.pancreas": 3000,
  "cow.visceral.spleen": 4000,
  "cow.visceral.small-intestine": 30000,
  "cow.visceral.large-intestine": 20000,
  "cow.visceral.kidneys.L": 6000,
  "cow.visceral.kidneys.R": 6000,
  "cow.visceral.urinary-bladder": 3000,
  "cow.visceral.uterus": 6000,
  "cow.visceral.ovaries.L": 800,
  "cow.visceral.ovaries.R": 800,
  "cow.visceral.thyroid": 1500,
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

// Stomach compartments, in the model frame (units of 5 cm: the stomach is
// about 0.5 x 0.57 x 0.88 m; cow_visceral.py sets the final size).
const STOMACH_SEEDS: Record<string, Pick[]> = {
  rumen: [["R", -0.015, 0.136], ["R", 0.208, -0.119], ["R", 0.319, 0.136], ["L", -0.126, 0.136], ["L", -0.326, -0.119], ["L", -0.102, -0.026]],
  reticulum: [["V", -0.089, -0.241], ["R", -0.348, -0.053]],
  omasum: [["V", 0.077, -0.308], ["L", 0.297, -0.053]],
  abomasum: [["V", 0.022, -0.074], ["V", 0.1, -0.008], ["V", 0.178, 0.092], ["V", 0.211, 0.181]],
  cardia: [[0.047, 0.123, 0.4]],
  duodenum: [["D", -0.2, 0.2]],
};
const stomach = await (async () => {
  const surface = new Surface(await scan(sources.stomach, 0.05, 400_000));
  const names = Object.keys(STOMACH_SEEDS);
  const seeded = new Map<number, number>();
  for (const [l, n] of names.entries()) for (const s of STOMACH_SEEDS[n]) seeded.set(surface.pick(s), l);
  const label = surface.watershed(seeded, 40);
  const part = (...ns: string[]) => surface.extract(label, (l) => ns.includes(names[l]), undefined, 0.05);
  return new Map([
    ["rumen", part("rumen")],
    ["reticulum", part("reticulum", "cardia")],
    ["omasum", part("omasum")],
    ["abomasum", part("abomasum", "duodenum")],
  ]);
})();

fs.mkdirSync(WORK, { recursive: true });
writeBin(path.join(WORK, "stomach"), stomach);
writeBin(path.join(WORK, "heart"), new Map([["heart", await scan(sources.heart, 0.001, 200_000)]]));
writeBin(path.join(WORK, "skeleton"), await readAtlas(SKELETON));

execFileSync(PYTHON, ["-I", path.join("scripts", "ct", "cow_visceral.py"), WORK], { stdio: "inherit" });

const organs = readBin(path.join(WORK, "organs"));
const model = createModel("cow.visceral", [0.79, 0.56, 0.53, 1]);
for (const [id, tris] of Object.entries(meshes)) {
  const g = organs.get(id);
  if (!g) throw new Error(`cow_visceral.py produced no mesh for ${id}`);
  model.add(meshKey(id), g, tris);
}
await model.write(OUT);
