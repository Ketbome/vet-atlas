/**
 * Builds public/models/horse/skeletal.glb. Sources:
 * - "Horse Skeleton" by Diego Luján García (Sketchfab, CC BY 4.0): a whole
 *   standing horse sculpted from a real skeleton and anatomical references,
 *   every bone a separate, unnamed shell (symmetric except the limbs, which
 *   are in a walking stance). The shells are split by connectivity and
 *   labelled by position below (fidelity "modeled"). The trunk is kept as
 *   sculpted; the right thoracic and left pelvic limbs are mirrored to the
 *   other side so the horse stands square.
 * - "Horse (Equus ferus caballus)" by The University of Edinburgh Open.Ed
 *   (Sketchfab, CC BY 4.0): a CT reconstruction of a horse head that
 *   replaces the sculpted skull and mandible, registered onto them by ICP
 *   with a free scale (fidelity "scan").
 *
 * Downloads go to .cache/models/ (needs SKETCHFAB_TOKEN in .env.local). The
 * sculpt is in arbitrary units (about 7.4 long, tail included), Y up, the
 * horse facing +Z with its left side at +X; it is rotated 180° about Y and
 * scaled to a height at the withers of WITHERS.
 *
 * Output conventions: metres, Y up, floor at y=0, animal faces -Z, animal's
 * left side is -X. One mesh per structure (or per side, vertebra or rib)
 * named with meshKey().
 */
import path from "node:path";
import { Matrix4, Vector3 } from "three";
import { meshKey } from "../lib/content/mesh";
import { bake, bounds, components, createModel, download, merge, mirror, pcaStarts, points, readPrims, register, transform, type Geometry } from "./lib/glb";

const OUT = path.join(process.cwd(), "public", "models", "horse", "skeletal.glb");
const WITHERS = 1.6;

const sources = {
  sculpt: { uid: "eaca504567604e879b8ab2cf2763025e", file: "diegoluga-horse-skeleton.glb" },
  head: { uid: "ea9a974658fc4cab9860b75024f51791", file: "edinburgh-horse-skull-ct.glb" },
};

type V = Vector3;
type Shell = { g: Geometry; min: V; max: V; center: V; size: V; tris: number };

const shell = (g: Geometry): Shell => ({ g, ...bounds(g), tris: g.index.length / 3 });
const inside = (p: V, s: { min: V; max: V }, pad = 0) => p.x >= s.min.x - pad && p.x <= s.max.x + pad && p.y >= s.min.y - pad && p.y <= s.max.y + pad && p.z >= s.min.z - pad && p.z <= s.max.z + pad;

// Keeps the triangles whose centroid passes `keep`, with only their vertices.
function subset(g: Geometry, keep: (c: V) => boolean): Geometry {
  const remap = new Map<number, number>();
  const index: number[] = [];
  const c = new Vector3();
  const v = new Vector3();
  for (let i = 0; i < g.index.length; i += 3) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.add(v.fromArray(g.position, g.index[i + k] * 3));
    if (!keep(c.divideScalar(3))) continue;
    for (let k = 0; k < 3; k++) {
      const id = g.index[i + k];
      if (!remap.has(id)) remap.set(id, remap.size);
      index.push(remap.get(id)!);
    }
  }
  const position = new Float32Array(remap.size * 3);
  for (const [id, j] of remap) position.set(g.position.subarray(id * 3, id * 3 + 3), j * 3);
  return { position, index: new Uint32Array(index) };
}

// Smallest distance between two meshes, on subsampled vertices.
function gap(a: Geometry, b: Geometry, n = 400) {
  const pa = points(a, n);
  const pb = points(b, n);
  let best = Infinity;
  for (const p of pa) for (const q of pb) best = Math.min(best, p.distanceToSquared(q));
  return Math.sqrt(best);
}

// ---------------------------------------------------------------------------
// Sculpt: shells in the atlas orientation (still in sculpt units).

const sculpt = components(bake(await readPrims(await download(sources.sculpt)), new Matrix4().makeRotationY(Math.PI)))
  .map(shell)
  .sort((a, b) => b.tris - a.tris);
const length = bounds(merge(sculpt.map((s) => s.g))).size.z;
console.log(`sculpt: ${sculpt.length} shells, length ${length.toFixed(3)}`);
const pool = new Set(sculpt);
const take = (s: Shell) => (pool.delete(s), s);
const isMedian = (s: Shell) => Math.abs(s.center.x) < length * 0.004;

// Head: the largest shell is the skull, the largest median shell under it the
// mandible. Every small shell inside them is a tooth and goes with the nearer
// of the two, as registration targets only (the CT has its teeth).
const skullS = take(sculpt[0]);
const mandibleS = take([...pool].filter((s) => isMedian(s) && inside(s.center, skullS, length * 0.02))[0]);
const teeth = [...pool].filter((s) => s.size.length() < length * 0.03 && (inside(s.center, skullS, length * 0.01) || inside(s.center, mandibleS, length * 0.01)));
teeth.forEach(take);
const upperTeeth = teeth.filter((t) => gap(t.g, skullS.g, 200) < gap(t.g, mandibleS.g, 200));
console.log(`teeth: ${teeth.length} (${upperTeeth.length} upper)`);

// Both hip bones are one shell (fused at the pelvic symphysis): the largest
// median shell caudal to the middle of the body.
const pelvisS = take([...pool].filter((s) => isMedian(s) && s.center.z > 0).sort((a, b) => b.tris - a.tris)[0]);

// Ventral median shells: the sternum (the largest) and the costal cartilages
// that cross the median plane.
const ventral = [...pool].filter((s) => isMedian(s) && s.max.y < pelvisS.min.y && s.center.z < pelvisS.min.z).sort((a, b) => b.tris - a.tris);
const sternumS = take(ventral[0]);
const medianCartilages = ventral.slice(1).map(take);

// Vertebral column: the remaining median shells chained by nearest centroid
// from the one closest to the back of the skull.
const spine: Shell[] = [];
{
  const rest = [...pool].filter(isMedian);
  let at = new Vector3(0, skullS.center.y, skullS.max.z);
  while (rest.length) {
    rest.sort((a, b) => a.center.distanceTo(at) - b.center.distanceTo(at));
    const next = rest.shift()!;
    spine.push(take(next));
    at = next.center;
  }
}
// Atlas, axis, C3-C7, T1-T18, L1-L6, sacrum, then the tail.
const CERVICAL = 7;
const THORACIC = 18;
const LUMBAR = 6;
const sacrumAt = CERVICAL + THORACIC + LUMBAR;
const sacrumS = spine[sacrumAt];
console.log(`spine: ${spine.length} shells: ${spine.map((s) => s.tris).join(" ")}`);
if (!inside(sacrumS.center, pelvisS) || spine.slice(0, sacrumAt).some((s) => s.tris > sacrumS.tris)) throw new Error("vertebral count does not end at the sacrum");
const caudal = spine.slice(sacrumAt + 1);
console.log(`spine: ${caudal.length} caudal vertebrae, ${medianCartilages.length} median cartilages`);

// ---------------------------------------------------------------------------
// Paired bones, labelled per side the same way (both sides are sculpted, the
// limbs in a walking stance).

const splitZ = (sternumS.max.z + pelvisS.min.z) / 2;
const vertebraCenters = spine.slice(0, sacrumAt).map((s) => s.center);
const g = (ss: Shell[]) => merge(ss.map((s) => s.g));

// The radius and ulna are one shell (fused, as in the adult horse). The ulna
// is everything above the elbow joint (the olecranon, above the distal end
// of the humerus) plus the caudal strip of the shaft that tapers off at the
// middle of the forearm.
function splitForearm(forearm: Shell, humerus: Shell) {
  const elbow = humerus.min.y + humerus.size.y * 0.06;
  const ps = points(forearm.g, 6000);
  const top = forearm.max.y;
  const mid = forearm.min.y + forearm.size.y * 0.5;
  // Cranial edge of the shaft at each height: the ulna is what lies more than
  // `depth` caudal to it.
  const front = (y: number) => {
    const band = ps.filter((p) => Math.abs(p.y - y) < forearm.size.y * 0.03);
    return Math.min(...band.map((p) => p.z));
  };
  const depth = (y: number) => {
    const band = ps.filter((p) => Math.abs(p.y - y) < forearm.size.y * 0.03);
    return Math.max(...band.map((p) => p.z)) - Math.min(...band.map((p) => p.z));
  };
  const radiusDepth = depth(forearm.min.y + forearm.size.y * 0.3);
  const cache = new Map<number, number>();
  const frontAt = (y: number) => {
    const key = Math.round(y * 200);
    if (!cache.has(key)) cache.set(key, front(key / 200));
    return cache.get(key)!;
  };
  const test = (c: V) => c.y > elbow || (c.y > mid && c.z - frontAt(c.y) > radiusDepth * (0.75 + (0.25 * (top - c.y)) / (top - mid)));
  return { radius: subset(forearm.g, (c) => !test(c)), ulna: subset(forearm.g, test) };
}

function side(sign: number) {
  const mine = [...pool].filter((s) => Math.sign(s.center.x) === sign);
  const out = new Map<string, Geometry>();
  const used = new Set<Shell>();
  const claim = (s: Shell) => (used.add(s), s);
  const free = () => mine.filter((s) => !used.has(s));
  const label = sign < 0 ? "L" : "R";

  // Long bones: the large shells, top to bottom.
  const long = mine.filter((s) => s.tris >= 1800);
  const fore = long.filter((s) => s.center.z < splitZ).sort((a, b) => b.center.y - a.center.y);
  const hind = long.filter((s) => s.center.z >= splitZ).sort((a, b) => b.center.y - a.center.y);
  if (fore.length !== 4 || hind.length !== 3) throw new Error(`long bones ${label}: ${fore.length} thoracic, ${hind.length} pelvic`);
  const [scapula, humerus, forearm, metacarpus] = fore.map(claim);
  const [femur, tibia, metatarsus] = hind.map(claim);
  const { radius, ulna } = splitForearm(forearm, humerus);
  out.set("scapula", scapula.g).set("humerus", humerus.g).set("radius", radius).set("ulna", ulna).set("metacarpus", metacarpus.g);
  out.set("femur", femur.g).set("metatarsus", metatarsus.g);

  const one = (name: string, list: Shell[]) => {
    if (list.length !== 1) throw new Error(`${name} ${label}: ${list.length} candidates`);
    return claim(list[0]);
  };
  const hindFree = () => free().filter((s) => s.center.z >= splitZ);
  const foreFree = () => free().filter((s) => s.center.z < splitZ);
  const patella = one("patella", hindFree().filter((s) => s.tris < 600 && inside(s.center, femur, length * 0.03) && s.center.y > tibia.max.y - tibia.size.y * 0.15));
  const fibula = one("fibula", hindFree().filter((s) => s.tris < 600 && inside(s.center, tibia, length * 0.01) && s.size.y > tibia.size.y * 0.4));
  out.set("patella", patella.g).set("tibia", merge([tibia.g, fibula.g]));

  const pes = hindFree().filter((s) => s.center.y < metatarsus.min.y + metatarsus.size.y * 0.1).map(claim);
  const tarsus = hindFree().filter((s) => s.center.y < tibia.min.y + tibia.size.y * 0.3 && s.center.y > metatarsus.max.y - metatarsus.size.y * 0.2).map(claim);
  const manus = foreFree().filter((s) => s.center.y < metacarpus.min.y + metacarpus.size.y * 0.1).map(claim);
  const carpus = foreFree().filter((s) => s.center.y < forearm.min.y + forearm.size.y * 0.1 && s.center.y > metacarpus.max.y - metacarpus.size.y * 0.2).map(claim);
  out.set("carpus", g(carpus)).set("phalanges-thoracic", g(manus)).set("tarsus", g(tarsus)).set("phalanges-pelvic", g(pes));
  console.log(`limbs ${label}: carpus ${carpus.length}, phalanges ${manus.length}; tarsus ${tarsus.length}, phalanges ${pes.length}`);

  // Ribs: bony ribs reach the vertebral bodies, costal cartilages do not.
  // Ribs are numbered by the craniocaudal position of the head; a cartilage
  // touching one rib joins it, the fused cartilages of the costal arch (they
  // touch several) are a mesh of their own.
  const trunk = free();
  const reach = (s: Shell) => Math.min(...points(s.g, 600).map((p) => Math.min(...vertebraCenters.map((c) => c.distanceTo(p)))));
  const bony = trunk.filter((s) => reach(s) < length * 0.04);
  const cartilages = [...trunk.filter((s) => !bony.includes(s)), ...medianCartilages.map((m) => shell(subset(m.g, (c) => Math.sign(c.x) === sign)))];
  const head = (s: Shell) => points(s.g, 2000).sort((a, b) => Math.abs(a.x) - Math.abs(b.x))[0];
  bony.sort((a, b) => head(a).z - head(b).z);
  if (bony.length !== THORACIC) throw new Error(`ribs ${label}: ${bony.length}`);
  const ribs = bony.map((s) => [claim(s)]);
  const arch: Shell[] = [];
  for (const c of cartilages) {
    if (trunk.includes(c)) claim(c);
    const d = bony.map((r) => gap(c.g, r.g, 300));
    const near = d.filter((x) => x < length * 0.006).length;
    if (near > 1) arch.push(c);
    else ribs[d.indexOf(Math.min(...d))].push(c);
  }
  console.log(`ribs ${label}: cartilages per rib ${ribs.map((r) => r.length - 1).join("")}, costal arch ${arch.length}`);
  ribs.forEach((r, i) => out.set(`ribs.${i + 1}`, g(r)));
  if (arch.length) out.set("ribs.arch", g(arch));

  const rest = free();
  if (rest.length) console.warn(`unlabelled shells (${label}): ${rest.map((s) => `${s.tris}@${s.center.toArray().map((x) => x.toFixed(2))}`).join(" ")}`);
  return out;
}
const paired = { L: side(-1), R: side(1) };

// The limbs are sculpted in a walking stance. The atlas stands square: the
// right thoracic limb and the left pelvic limb (the upright pair) are kept
// and mirrored to the other side.
const FORE = ["scapula", "humerus", "radius", "ulna", "carpus", "metacarpus", "phalanges-thoracic"];
const HIND = ["femur", "patella", "tibia", "tarsus", "metatarsus", "phalanges-pelvic"];
for (const key of FORE) paired.L.set(key, mirror(paired.R.get(key)!));
for (const key of HIND) paired.R.set(key, mirror(paired.L.get(key)!));

// Hip bones: the pelvis shell cut at the median plane.
paired.L.set("os-coxae", subset(pelvisS.g, (c) => c.x < 0));
paired.R.set("os-coxae", subset(pelvisS.g, (c) => c.x >= 0));

// ---------------------------------------------------------------------------
// Scale to the height at the withers (top of the highest thoracic spinous
// process), floor at y=0, nose-to-tail centred on z=0.

const floorY = Math.min(...[...paired.L.values(), ...paired.R.values()].map((x) => bounds(x).min.y));
const top = Math.max(...spine.slice(CERVICAL, CERVICAL + THORACIC).map((s) => s.max.y));
const k = WITHERS / (top - floorY);
const all = bounds(merge(sculpt.map((s) => s.g)));
const toAtlas = new Matrix4().makeScale(k, k, k).multiply(new Matrix4().makeTranslation(0, -floorY, -all.center.z));
const place = (x: Geometry) => transform(x, toAtlas);
for (const map of Object.values(paired)) for (const [key, x] of map) map.set(key, place(x));
console.log(`scale ${k.toFixed(4)} m/unit, length ${(all.size.z * k).toFixed(2)} m`);

// ---------------------------------------------------------------------------
// Skull and mandible from the CT (arbitrary units and orientation): its two
// large shells, in occlusion as scanned, registered together (one similarity)
// onto the sculpted skull, mandible and teeth. Loose CT debris is dropped.

const [ctA, ctB] = components(bake(await readPrims(await download(sources.head)), new Matrix4())).sort((a, b) => b.index.length - a.index.length);
// The skull is the shell with the larger bounding box.
const vol = (x: Geometry) => {
  const b = bounds(x).size;
  return b.x * b.y * b.z;
};
const [ctSkull, ctMandible] = vol(ctA) > vol(ctB) ? [ctA, ctB] : [ctB, ctA];
const head = merge([ctSkull, ctMandible]);
const headTarget = place(merge([skullS.g, mandibleS.g, ...teeth.map((t) => t.g)]));
const fitted = register(head, headTarget, pcaStarts(head, headTarget, true), { withScale: true });
console.log(`head: ICP rms ${(fitted.rms * 1000).toFixed(1)} mm, skull length ${(bounds(transform(ctSkull, fitted.m)).size.z * 100).toFixed(1)} cm`);
const skull = transform(ctSkull, fitted.m);
const mandible = transform(ctMandible, fitted.m);

// ---------------------------------------------------------------------------
// Output.

const model = createModel("horse.skeletal", [0.91, 0.89, 0.83, 1]);
const addMesh = model.add;

addMesh(meshKey("horse.skeletal.skull"), skull, 40000);
addMesh(meshKey("horse.skeletal.mandible"), mandible, 20000);
addMesh(meshKey("horse.skeletal.atlas"), place(spine[0].g), 4000);
addMesh(meshKey("horse.skeletal.axis"), place(spine[1].g), 4000);
for (let i = 2; i < CERVICAL; i++) addMesh(meshKey(`horse.skeletal.vertebrae-cervical.c${i + 1}`), place(spine[i].g), 3000);
for (let i = 0; i < THORACIC; i++) addMesh(meshKey(`horse.skeletal.vertebrae-thoracic.t${i + 1}`), place(spine[CERVICAL + i].g), 2500);
for (let i = 0; i < LUMBAR; i++) addMesh(meshKey(`horse.skeletal.vertebrae-lumbar.l${i + 1}`), place(spine[CERVICAL + THORACIC + i].g), 2500);
addMesh(meshKey("horse.skeletal.sacrum"), place(sacrumS.g), 5000);
caudal.forEach((s, i) => addMesh(meshKey(`horse.skeletal.vertebrae-caudal.cd${i + 1}`), place(s.g), 1200));
addMesh(meshKey("horse.skeletal.sternum"), place(sternumS.g), 4000);

for (const s of ["L", "R"] as const) {
  for (const [key, x] of paired[s]) addMesh(meshKey(`horse.skeletal.${key}.${s}`), x, 8000);
}

await model.write(OUT);
