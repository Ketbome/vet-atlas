/**
 * Builds public/models/cow/skeletal.glb. Sources:
 * - "Skelet jonge koe | skeleton young cow (800-1000)" by Archeologiemuseum
 *   Huis van Hilde (model by Kees Zwaan), Sketchfab, CC BY-SA 4.0: a
 *   photogrammetry scan of the mounted skeleton of a heifer of 1.5-2 years
 *   (withers 1.07 m) found at Wijk aan Zee. The scan is one fused surface,
 *   stand and support wires included, so it is cut into bones here (see
 *   "Segmentation"). Fidelity "scan".
 * - "Metacarpo de vaca/buey - VIRTARMED" by PRINMA (Universidad de Granada),
 *   Sketchfab, CC BY 4.0: the metacarpus, missing on both sides of the mount.
 *   An adult draught ox; scaled to the heifer.
 * - Modeled here: the carpus (missing from the mount; illustrative), the ribs
 *   (the mount's are broken: 13 per side rebuilt from its complete ones,
 *   "modeled") and the costal cartilages.
 *
 * The mount is missing the carpus and metacarpus of both thoracic limbs, the
 * right radius and ulna and the right pelvic digits, and its thoracic digits
 * hang from a wire. The atlas skeleton is the left side plus the median bones,
 * with the right side mirrored (as in the dog); the thoracic digits are the
 * right ones, mirrored, set under the metacarpus.
 *
 * Downloads go to .cache/models/ (needs SKETCHFAB_TOKEN in .env.local).
 * Output conventions: metres, Y up, floor at y=0, animal faces -Z, animal's
 * left side is -X. One mesh per structure (or per side, vertebra or rib)
 * named with meshKey().
 */
import path from "node:path";
import { Matrix4, Quaternion, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { meshKey } from "../lib/content/mesh";
import { bake, bounds, capsule, components, createModel, download, fromThree, mean, merge, mirror, pca, points, readPrims, sphere, transform, type Geometry } from "./lib/glb";
import { Surface, offAxis, weldSimplify, type Pick } from "./lib/segment";

const OUT = path.join(process.cwd(), "public", "models", "cow", "skeletal.glb");
// Museum measurements of the mount, stand included: 163 x 110 x 30 cm.
const MOUNT_LENGTH = 1.63;

const sources = {
  mount: { uid: "f35da42a9d0243d483b437646985f757", file: "hilde-young-cow-skeleton.glb" },
  metacarpus: { uid: "3ca7725a74d349d5bdc585c5fdf6075e", file: "prinma-cow-metacarpus-granada.glb" },
};

type V = Vector3;

// ---------------------------------------------------------------------------
// Working mesh: the mount in the atlas frame (stand base at y=0, centred on
// x and z), welded and simplified to 1.5 M triangles (about 1 mm error).

const surface = await (async () => {
  const g = bake(await readPrims(await download(sources.mount)), new Matrix4().makeRotationY(-Math.PI / 2));
  const b = bounds(g);
  const k = MOUNT_LENGTH / b.size.z;
  const m = transform(g, new Matrix4().makeScale(k, k, k).multiply(new Matrix4().makeTranslation(-b.center.x, -b.min.y, -b.center.z)));
  const simple = weldSimplify(m, 1_500_000);
  console.log(`mount: ${g.index.length / 3} -> ${simple.index.length / 3} triangles`);
  return new Surface(simple);
})();
const { P, I, nv } = surface;
const at = (v: number) => surface.at(v);

// ---------------------------------------------------------------------------
// Segmentation (scripts/lib/segment.ts): every bone gets a few seeds and
// grows along the surface until it meets its neighbours in the grooves of the
// joints (young epiphyses stay with their bone because they are seeded too).
// Seeds are picked on lateral renders of the working mesh (L: seen from the
// left, R: from the right). Thoracic and lumbar seeds are the tips of the spinous processes
// (13 thoracic, 6 lumbar: the lumbar ones are the vertebrae with the long
// transverse processes), given as points; the thoracic ones also get a point
// in the body, between the costal foveae of their ribs (the bodies are fused
// into one tube in the scan, and their slanted spines end over the next
// vertebra).

const CREASE = 40;

const seeds: Record<string, Pick[]> = {
  stand: [["L", -0.46, 0.8571], ["L", -0.4029, 0.7857]],
  skull: [["L", -0.6207, 0.9321], ["L", -0.7279, 0.9464], ["L", -0.535, 0.9929], ["L", -0.6707, 0.975]],
  mandible: [["L", -0.6921, 0.8679], ["L", -0.5564, 0.8714], ["L", -0.7707, 0.8964]],
  c1: [["L", -0.4935, 0.9435, "x>-0.06"]],
  c2: [["L", -0.4259, 0.9112, "x>-0.06"]],
  c3: [["L", -0.3876, 0.867, "x>-0.06"]],
  c4: [["L", -0.3612, 0.8435, "x>-0.06"]],
  c5: [["L", -0.3376, 0.82, "x>-0.06"]],
  c6: [["L", -0.3082, 0.8024, "x>-0.06"], [-0.018, 0.826, -0.312]],
  c7: [["L", -0.2759, 0.7818, "x>-0.06"], [-0.016, 0.838, -0.279]],
  t1: [[-0.013, 0.905, -0.222], [-0.014, 0.769, -0.247]],
  t2: [[-0.009, 0.916, -0.176], [-0.012, 0.775, -0.212]],
  t3: [[-0.008, 0.924, -0.131], [-0.010, 0.781, -0.176]],
  t4: [[-0.003, 0.922, -0.094], [-0.008, 0.786, -0.143]],
  t5: [[0.002, 0.925, -0.048], [-0.006, 0.792, -0.109]],
  t6: [[0.004, 0.921, -0.013], [-0.004, 0.798, -0.073]],
  t7: [[0.005, 0.91, 0.038], [-0.002, 0.804, -0.037]],
  t8: [[0.007, 0.914, 0.069], [0.000, 0.810, 0.000]],
  t9: [[0.009, 0.918, 0.098], [0.002, 0.816, 0.033]],
  t10: [[0.011, 0.908, 0.13], [0.004, 0.821, 0.064]],
  t11: [[0.012, 0.893, 0.143], [0.006, 0.826, 0.095]],
  t12: [[0.014, 0.892, 0.16], [0.008, 0.832, 0.126]],
  t13: [[0.016, 0.893, 0.18], [0.010, 0.837, 0.158]],
  l1: [[0.019, 0.889, 0.215]],
  l2: [[0.022, 0.885, 0.263]],
  l3: [[0.025, 0.881, 0.31]],
  l4: [[0.028, 0.872, 0.357]],
  l5: [[0.031, 0.865, 0.405]],
  l6: [[0.033, 0.858, 0.45]],
  sacrum: [[0.022, 0.855, 0.491], [0.035, 0.838, 0.53], [0.035, 0.833, 0.594]],
  cd1: [["L", 0.6, 0.835]],
  cd2: [["L", 0.632, 0.823]],
  sternum: [["L", -0.143, 0.5296], ["L", -0.2055, 0.5504]],
  "ribs.L": [["L", -0.1162, 0.6512, "x<-0.025"], ["L", -0.0738, 0.6512, "x<-0.025"], ["L", -0.0392, 0.6281, "x<-0.025"], ["L", -0.0085, 0.6281, "x<-0.025"], ["L", 0.03, 0.6281, "x<-0.025"], ["L", 0.0646, 0.6512, "x<-0.025"], ["L", 0.0915, 0.7282, "x<-0.025"], ["L", 0.1223, 0.6281, "x<-0.025"], ["L", 0.13, 0.8205, "x<-0.025"], ["L", 0.1838, 0.8358, "x<-0.025"]],
  "ribs.R": [["R", -0.0662, 0.7097, "x>0.025"], ["R", -0.0354, 0.6712, "x>0.025"], ["R", 0.0031, 0.6712, "x>0.025"], ["R", 0.0415, 0.6712, "x>0.025"], ["R", 0.08, 0.6712, "x>0.025"], ["R", 0.1223, 0.6712, "x>0.025"], ["R", -0.116, 0.617, "x>0.025"]],
  "scapula.L": [["L", -0.2067, 0.6867, "x<0"], ["L", -0.1733, 0.7533, "x<0"], ["L", -0.24, 0.633, "x<0"]],
  "humerus.L": [["L", -0.2472, 0.5358, "x<0"], ["L", -0.3097, 0.5733, "x<0"], ["L", -0.168, 0.486, "x<0"]],
  "radius.L": [["L", -0.2055, 0.369, "x<0"], ["L", -0.218, 0.286, "x<0"], ["L", -0.168, 0.4525, "x<0"]],
  "ulna.L": [["L", -0.118, 0.49, "x<0"], ["L", -0.135, 0.465, "x<0"]],
  "scapula.R": [["R", 0.2367, 0.72, "x>0"]],
  "humerus.R": [["R", 0.2, 0.53, "x>0"], ["R", 0.2667, 0.57, "x>0"]],
  "phalanges-thoracic.R": [["R", 0.2433, 0.0667, "x>0"], ["R", 0.2633, 0.0333, "x>0"]],
  pelvis: [["L", 0.605, 0.739, "x<0"], ["L", 0.672, 0.748, "x<0"], ["L", 0.505, 0.806, "x<0"], ["R", -0.575, 0.7467, "x>0"]],
  "femur.L": [["L", 0.53, 0.681, "x<0"], ["L", 0.4925, 0.6435, "x<0"], ["L", 0.455, 0.606, "x<0"], ["L", 0.4295, 0.5425, "x<0"]],
  "patella.L": [["L", 0.3795, 0.5588, "x<0"]],
  "tibia.L": [["L", 0.4717, 0.4393, "x<0"], ["L", 0.5383, 0.3643, "x<0"], ["L", 0.4345, 0.4875, "x<0"]],
  "tarsus.L": [["L", 0.584, 0.281, "x<0"]],
  "metatarsus.L": [["L", 0.588, 0.173, "x<0"], ["L", 0.588, 0.131, "x<0"]],
  "phalanges-pelvic.L": [["L", 0.563, 0.056, "x<0"], ["L", 0.53, 0.035, "x<0"]],
  "femur.R": [["R", -0.475, 0.6467, "x>0"]],
  "tibia.R": [["R", -0.45, 0.4383, "x>0"]],
  "tarsus.R": [["R", -0.5083, 0.305, "x>0"]],
  "metatarsus.R": [["R", -0.4917, 0.197, "x>0"]],
};
const labels = Object.keys(seeds);
const STAND = labels.indexOf("stand");

// Stand: the floor frame, plus every vertex thinner than 6 mm whose 8 mm
// neighbourhood is a line (a wire, not the edge of a bone plate), kept only in
// connected runs longer than 5 cm.
// `lineish`: thin and locally a line (also used to strip wires from bones).
const lineish = new Uint8Array(nv);
const wire = (() => {
  const cell = 0.008;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let v = 0; v < nv; v++) {
    const k = key(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(v);
  }
  const flag = new Uint8Array(nv);
  for (let v = 0; v < nv; v++) {
    if (P[v * 3 + 1] < 0.012) {
      flag[v] = 1;
      continue;
    }
    if (surface.thickness[v] >= 0.006) continue;
    const p = at(v);
    const near: V[] = [];
    const [cx, cy, cz] = [0, 1, 2].map((d) => Math.floor(P[v * 3 + d] / cell));
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const w of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) if (at(w).distanceToSquared(p) < cell * cell) near.push(at(w));
    if (near.length > 6 && offAxis(near) < 0.08) flag[v] = lineish[v] = 1;
  }
  const out = new Uint8Array(nv);
  for (const run of surface.runs((v) => flag[v] === 1)) if (surface.extent(run).size.length() >= 0.05) for (const v of run) out[v] = 1;
  return out;
})();

const seeded = new Map<number, number>();
for (let v = 0; v < nv; v++) if (wire[v]) seeded.set(v, STAND);
for (const [l, name] of labels.entries()) for (const s of seeds[name]) seeded.set(surface.pick(s), l);
let label = surface.watershed(seeded, CREASE);

// Second pass: rib shafts flooded from a vertebra (unseeded ribs) become rib
// seeds: parts of the column more than 7.5 cm from the median plane (which
// drifts right towards the tail in the mount), or below the bodies of the
// thoracic vertebrae and off the median plane.
const midX = (z: number) => -0.018 + (z + 0.31) * 0.0589;
{
  const thoracic = ["c7", ...Array.from({ length: 13 }, (_, i) => `t${i + 1}`)].map((n) => labels.indexOf(n));
  const column = new Set([...thoracic, ...["l1", "ribs.L", "ribs.R"].map((n) => labels.indexOf(n))]);
  const floor = new Map(thoracic.map((l) => [l, Infinity]));
  for (let v = 0; v < nv; v++) if (floor.has(label[v]) && Math.abs(P[v * 3] - midX(P[v * 3 + 2])) < 0.02) floor.set(label[v], Math.min(floor.get(label[v])!, P[v * 3 + 1]));
  for (let v = 0; v < nv; v++) {
    if (!column.has(label[v])) continue;
    const off = P[v * 3] - midX(P[v * 3 + 2]);
    const below = floor.has(label[v]) && P[v * 3 + 1] < floor.get(label[v])! - 0.01 && Math.abs(off) > 0.025;
    if (Math.abs(off) > 0.075 || below) seeded.set(v, labels.indexOf(off < 0 ? "ribs.L" : "ribs.R"));
  }
  label = surface.watershed(seeded, CREASE);
}
console.log(labels.map((name, l) => `${name}:${label.reduce((n, x) => n + (x === l ? 1 : 0), 0)}`).join(" "));

if (process.env.COW_DEBUG) {
  const fs = await import("node:fs");
  fs.writeFileSync(".cache/tools/cow/mesh.bin", Buffer.concat([Buffer.from(new Uint32Array([nv, I.length]).buffer), Buffer.from(P.buffer), Buffer.from(I.buffer)]));
  fs.writeFileSync(".cache/tools/cow/labels.bin", Buffer.from(label.buffer));
  fs.writeFileSync(".cache/tools/cow/labels.bin.json", JSON.stringify(labels));
  fs.writeFileSync(".cache/tools/cow/labels.bin.seeds.json", JSON.stringify([...seeded].filter(([, l]) => l !== STAND).map(([v]) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]])));
}

// ---------------------------------------------------------------------------
// Ribs of the mount. They touch each other, so each rib crossing the band
// y = 0.70 m gets its own label, seeded where it crosses the band (vertices
// clustered by z), and the rib labels are flooded again among themselves.
// Each is numbered by the thoracic vertebra nearest its tubercle (its most
// dorsal part): rib k meets Tk.

const RIB_BAND = 0.7;
const ribLabel = new Map<number, { side: "L" | "R" }>();
{
  const restricted = new Map<number, number>();
  for (const side of ["L", "R"] as const) {
    const l = labels.indexOf(`ribs.${side}`);
    const band: number[] = [];
    for (let v = 0; v < nv; v++) if (label[v] === l && Math.abs(P[v * 3 + 1] - RIB_BAND) < 0.004) band.push(v);
    band.sort((a, b) => P[a * 3 + 2] - P[b * 3 + 2]);
    let last = -Infinity;
    for (const v of band) {
      if (P[v * 3 + 2] - last > 0.008) {
        ribLabel.set(labels.length, { side });
        labels.push(`rib.${side}.${ribLabel.size}`);
      }
      last = P[v * 3 + 2];
      restricted.set(v, labels.length - 1);
    }
  }
  // Flood only inside the rib labels.
  const ribs = new Set(["ribs.L", "ribs.R"].map((n) => labels.indexOf(n)));
  const next = surface.watershed(restricted, CREASE, (v) => ribs.has(label[v]));
  for (let v = 0; v < nv; v++) if (ribs.has(label[v]) && next[v] >= 0) label[v] = next[v];
}

const tLabels = Array.from({ length: 13 }, (_, i) => labels.indexOf(`t${i + 1}`));
const tPoints = tLabels.map((l) => {
  const ps: V[] = [];
  for (let v = 0; v < nv; v += 3) if (label[v] === l) ps.push(at(v));
  return ps;
});
const mountRibs = [...ribLabel].map(([l, { side }]) => {
  const run: number[] = [];
  for (let v = 0; v < nv; v++) if (label[v] === l) run.push(v);
  const ps = run.map(at);
  const top = Math.max(...ps.map((p) => p.y));
  const crest = ps.filter((p) => p.y > top - 0.02);
  const tubercle = crest.reduce((a, p) => a.add(p), new Vector3()).divideScalar(crest.length);
  const d = tPoints.map((qs) => Math.min(...qs.map((q) => q.distanceTo(tubercle))));
  const k = d.indexOf(Math.min(...d)) + 1;
  const b = surface.extent(run);
  return { l, side, k, run, gap: Math.min(...d), top, bottom: b.min.y, span: b.size.length(), z: b.center.z };
});
for (const r of mountRibs.sort((a, b) => a.side.localeCompare(b.side) || a.z - b.z))
  console.log(`${labels[r.l]} -> rib ${r.side} ${r.k}: ${r.run.length} vertices, tubercle ${(r.gap * 1000).toFixed(0)} mm from T${r.k}, y ${r.bottom.toFixed(3)}-${r.top.toFixed(3)}, span ${r.span.toFixed(3)}, z ${r.z.toFixed(3)}`);
if (process.env.COW_DEBUG) {
  const fs = await import("node:fs");
  fs.writeFileSync(".cache/tools/cow/labels.bin", Buffer.from(label.buffer));
  fs.writeFileSync(".cache/tools/cow/labels.bin.json", JSON.stringify(labels));
}

// ---------------------------------------------------------------------------
// Bones: the triangles of each label (a triangle goes with the label most of
// its vertices carry). Wires that grew into a bone are dropped (runs of
// wire-like vertices, see `lineish`, longer than 2 cm), and so are loose
// islands under 2% of the bone.

function bone(names: string[]): Geometry {
  const ls = new Set(names.map((n) => labels.indexOf(n)));
  const drop = new Uint8Array(nv);
  for (const run of surface.runs((v) => ls.has(label[v]) && lineish[v] === 1)) if (surface.extent(run).size.length() > 0.02) for (const v of run) drop[v] = 1;
  const g = surface.extract(label, (l) => ls.has(l), drop);
  if (!g.index.length) throw new Error(`no geometry for ${names.join(", ")}`);
  return g;
}

// ---------------------------------------------------------------------------
// Median plane: the mount's axial skeleton drifts to the right towards the
// tail (about 3°). A line x = a + b z fitted through the vertebrae, skull and
// sacrum is turned onto z (rotation about Y) and moved to x = 0.

const axialNames = ["skull", "c1", "c2", "c3", "c4", "c5", "c6", "c7", ...tLabels.map((l) => labels[l]), "l1", "l2", "l3", "l4", "l5", "l6", "sacrum"];
const toMedian = (() => {
  let [n, sz, sx, szz, szx] = [0, 0, 0, 0, 0];
  const ls = new Set(axialNames.map((x) => labels.indexOf(x)));
  for (let v = 0; v < nv; v++) {
    if (!ls.has(label[v])) continue;
    const [x, z] = [P[v * 3], P[v * 3 + 2]];
    n++;
    sz += z;
    sx += x;
    szz += z * z;
    szx += z * x;
  }
  const b = (n * szx - sz * sx) / (n * szz - sz * sz);
  const a = (sx - b * sz) / n;
  console.log(`median line: x = ${a.toFixed(4)} + ${b.toFixed(4)} z (${((Math.atan(b) * 180) / Math.PI).toFixed(1)}°)`);
  return new Matrix4().makeRotationY(-Math.atan(b)).multiply(new Matrix4().makeTranslation(-a, 0, 0));
})();
const get = (...names: string[]) => transform(bone(names), toMedian);

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

// ---------------------------------------------------------------------------
// Assembly: median bones, and the left side (mirrored for the right).

const median = new Map<string, Geometry>([
  ["skull", get("skull")],
  ["mandible", get("mandible")],
  ["atlas", get("c1")],
  ["axis", get("c2")],
  ...[3, 4, 5, 6, 7].map((i) => [`vertebrae-cervical.c${i}`, get(`c${i}`)] as [string, Geometry]),
  ...Array.from({ length: 13 }, (_, i) => [`vertebrae-thoracic.t${i + 1}`, get(`t${i + 1}`)] as [string, Geometry]),
  ...Array.from({ length: 6 }, (_, i) => [`vertebrae-lumbar.l${i + 1}`, get(`l${i + 1}`)] as [string, Geometry]),
  ["sacrum", get("sacrum")],
  ["vertebrae-caudal.cd1", get("cd1")],
  ["vertebrae-caudal.cd2", get("cd2")],
  ["sternum", get("sternum")],
]);
const left = new Map<string, Geometry>([
  ["scapula", get("scapula.L")],
  ["humerus", get("humerus.L")],
  ["radius", get("radius.L")],
  ["ulna", get("ulna.L")],
  ["os-coxae", subset(get("pelvis"), (c) => c.x < 0)],
  ["femur", get("femur.L")],
  ["patella", get("patella.L")],
  ["tibia", get("tibia.L")],
  ["tarsus", get("tarsus.L")],
  ["metatarsus", get("metatarsus.L")],
  ["phalanges-pelvic", get("phalanges-pelvic.L")],
  ["phalanges-thoracic", mirror(get("phalanges-thoracic.R"))],
]);

// Centroid of the `frac` of a mesh's vertices with the largest projection on `dir`.
function end(g: Geometry, dir: V, frac = 0.05) {
  const ps = points(g, 6000).sort((p, q) => q.dot(dir) - p.dot(dir));
  const n = Math.max(1, Math.floor(ps.length * frac));
  return mean(ps.slice(0, n));
}
const down = new Vector3(0, -1, 0);
const span = (g: Geometry, dir: V) => {
  const ds = points(g, 6000).map((p) => p.dot(dir));
  return Math.max(...ds) - Math.min(...ds);
};

// Floor: the sole of the pelvic digits.
const floorY = bounds(left.get("phalanges-pelvic")!).min.y;

// Thoracic limb below the radius, vertical: carpus (modeled), metacarpus
// (scan) and digits (the mount's right ones, mirrored). The digits keep the
// pose they hang in (sole flat) and sit on the floor. The mount sets the
// limb about 4 cm low (the radius ends 25 cm above the floor, leaving 10 cm
// for a metacarpus that is 0.88 of the metatarsus in cattle), so scapula,
// humerus, radius and ulna are raised until the metacarpus has that length.
{
  const MC_RATIO = 0.88;
  const CARPUS = 0.045;
  const gap = 0.003;
  let digits = left.get("phalanges-thoracic")!;
  digits = transform(digits, new Matrix4().makeTranslation(0, floorY - bounds(digits).min.y, 0));
  const fetlockY = bounds(digits).max.y;
  const length = MC_RATIO * span(left.get("metatarsus")!, down);
  const raise = fetlockY + gap + length + gap * 2 + CARPUS - end(left.get("radius")!, down, 0.03).y;
  for (const key of ["scapula", "humerus", "radius", "ulna"]) left.set(key, transform(left.get(key)!, new Matrix4().makeTranslation(0, raise, 0)));
  const radius = left.get("radius")!;
  const wrist = end(radius, down, 0.03);
  const width = span(subset(radius, (c) => c.y < wrist.y + 0.03), new Vector3(1, 0, 0));
  console.log(`thoracic limb raised ${(raise * 100).toFixed(1)} cm: carpus at ${wrist.y.toFixed(3)} m, ${(width * 100).toFixed(1)} cm wide; metacarpus ${(length * 100).toFixed(1)} cm`);

  // Metacarpus: long axis vertical, proximal end up and dorsal face cranial
  // as scanned; scaled to `length`, centred under the wrist.
  const mc = await (async () => {
    const g = components(bake(await readPrims(await download(sources.metacarpus)), new Matrix4()))[0];
    const axis = pca(points(g, 6000)).axes[0];
    if (axis.y < 0) axis.negate();
    return transform(g, new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(axis, new Vector3(0, 1, 0))));
  })();
  const k = length / span(mc, down);
  const mcTop = end(mc, new Vector3(0, 1, 0), 0.03);
  const metacarpus = transform(mc, new Matrix4().makeTranslation(wrist.x, wrist.y - CARPUS - gap * 2, wrist.z).multiply(new Matrix4().makeScale(k, k, k)).multiply(new Matrix4().makeTranslation(-mcTop.x, -mcTop.y, -mcTop.z)));
  left.set("metacarpus", metacarpus);
  // Digits: their top centred under the condyles of the metacarpus.
  const condyles = end(metacarpus, down, 0.03);
  const crown = end(digits, new Vector3(0, 1, 0), 0.03);
  left.set("phalanges-thoracic", transform(digits, new Matrix4().makeTranslation(condyles.x - crown.x, 0, condyles.z - crown.z)));

  // Carpus: proximal row of three bones (radial, intermediate, ulnar) and the
  // accessory carpal projecting palmarly on the lateral side; distal row of
  // the fused second and third carpal and the fourth. Rounded blocks.
  const row = CARPUS / 2 - gap;
  const block = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const geometry = new RoundedBoxGeometry(sx, sy, sz, 3, Math.min(sx, sy, sz) * 0.35);
    geometry.translate(wrist.x + x, wrist.y - gap + y, wrist.z + z);
    return fromThree(geometry);
  };
  const w = width / 3;
  const d = width * 0.7;
  left.set(
    "carpus",
    merge([
      block(w, -row / 2, 0, w - gap, row, d),
      block(0, -row / 2, 0, w - gap, row, d * 1.05),
      block(-w, -row / 2, 0, w - gap, row, d * 0.95),
      block(-w * 1.05, -row * 0.45, d * 0.75, w * 0.7, row * 1.15, d * 0.55),
      block(w * 0.75, -row * 1.5 - gap, 0, w * 1.5 - gap, row, d),
      block(-w * 0.75, -row * 1.5 - gap, 0, w * 1.5 - gap, row, d * 0.95),
    ]),
  );
}

// ---------------------------------------------------------------------------
// Ribs: the mount's left ribs 4-9 are whole and kept as scanned; ribs 1-3 and
// 10-13 are rebuilt (as in the dog) by laying a template rib's surface along
// its centreline, shortened, with the head at the rib's costal fovea: ribs
// 1-3 from rib 4, 10-12 blended between rib 9 and the mount's right rib 13
// (mirrored), 13 from that rib. Fovea k sits between T(k-1) and Tk; on the
// scan they are the pits along the column at these z (m, mount frame), the
// last three spaced like the bodies.

const FOVEAE = [-0.262, -0.232, -0.191, -0.16, -0.126, -0.091, -0.055, -0.019, 0.02, 0.045, 0.08, 0.11, 0.142];
// Rib length relative to rib 7 (ribs 1-3 and 10-13).
const RIB_LENGTH: Record<number, number> = { 1: 0.5, 2: 0.62, 3: 0.75, 10: 0.92, 11: 0.84, 12: 0.74, 13: 0.62 };

function welded(g: Geometry) {
  const ids = new Map<string, number>();
  const pos: V[] = [];
  const remap = new Uint32Array(g.position.length / 3);
  for (let i = 0; i < remap.length; i++) {
    const key = `${Math.round(g.position[i * 3] * 1e5)},${Math.round(g.position[i * 3 + 1] * 1e5)},${Math.round(g.position[i * 3 + 2] * 1e5)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = pos.length;
      ids.set(key, id);
      pos.push(new Vector3().fromArray(g.position, i * 3));
    }
    remap[i] = id;
  }
  return { pos, remap };
}

// Dijkstra over mesh edges from one vertex.
function geodesic(g: Geometry, from: number) {
  const { pos, remap } = welded(g);
  const nbr: number[][] = pos.map(() => []);
  for (let i = 0; i < g.index.length; i += 3) {
    const [a, b, c] = [remap[g.index[i]], remap[g.index[i + 1]], remap[g.index[i + 2]]];
    nbr[a].push(b, c);
    nbr[b].push(a, c);
    nbr[c].push(a, b);
  }
  const dist = new Float64Array(pos.length).fill(Infinity);
  const heap: [number, number][] = [[0, remap[from]]];
  dist[remap[from]] = 0;
  while (heap.length) {
    let top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (l + 1 < heap.length && heap[l + 1][0] < heap[m][0]) m = l + 1;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    } else top = last;
    const [d, v] = top;
    if (d > dist[v]) continue;
    for (const w of nbr[v]) {
      const nd = d + pos[v].distanceTo(pos[w]);
      if (nd < dist[w]) {
        dist[w] = nd;
        heap.push([nd, w]);
        for (let i = heap.length - 1; i > 0; ) {
          const p = (i - 1) >> 1;
          if (heap[p][0] <= heap[i][0]) break;
          [heap[i], heap[p]] = [heap[p], heap[i]];
          i = p;
        }
      }
    }
  }
  return Array.from(remap, (id) => dist[id]);
}

function resample(line: V[], n: number) {
  const s = [0];
  for (let i = 1; i < line.length; i++) s.push(s[i - 1] + line[i].distanceTo(line[i - 1]));
  const out: V[] = [];
  for (let j = 0; j < n; j++) {
    const x = (s.at(-1)! * j) / (n - 1);
    let i = s.findIndex((v) => v >= x);
    if (i < 0) i = line.length - 1;
    if (i === 0) i = 1;
    out.push(line[i - 1].clone().lerp(line[i], Math.min(1, (x - s[i - 1]) / (s[i] - s[i - 1] || 1))));
  }
  return out;
}
const lengthOf = (line: V[]) => line.slice(1).reduce((a, p, i) => a + p.distanceTo(line[i]), 0);

// RMF along a polyline with the first normal taken from `hint`.
function lineFrames(line: V[], hint: V) {
  const t = line.map((_, i) => line[Math.min(i + 1, line.length - 1)].clone().sub(line[Math.max(i - 1, 0)]).normalize());
  const n = [hint.clone().sub(t[0].clone().multiplyScalar(hint.dot(t[0]))).normalize()];
  for (let i = 1; i < line.length; i++) n.push(n[i - 1].clone().applyQuaternion(new Quaternion().setFromUnitVectors(t[i - 1], t[i])));
  return line.map((_, i) => ({ t: t[i], n: n[i], b: t[i].clone().cross(n[i]) }));
}

const RIB_N = 48;
const ribHint = new Vector3(0, 0, 1);
function ribModel(g: Geometry) {
  const ps = points(g);
  // Head: the vertex nearest the median plane in the dorsal third.
  const b = bounds(g);
  const topY = b.max.y - b.size.y * 0.3;
  let head = 0;
  ps.forEach((p, i) => {
    if (p.y > topY && Math.abs(p.x) < Math.abs(ps[head].x)) head = i;
  });
  const d = geodesic(g, head);
  const dmax = Math.max(...d.filter(Number.isFinite));
  const bins: V[][] = Array.from({ length: 40 }, () => []);
  ps.forEach((p, i) => Number.isFinite(d[i]) && bins[Math.min(39, Math.floor((d[i] / dmax) * 40))].push(p));
  const raw = bins.filter((x) => x.length).map(mean);
  const line = resample(
    raw.map((_, i) => mean(raw.slice(Math.max(0, i - 1), i + 2))),
    RIB_N,
  );
  const fr = lineFrames(line, ribHint);
  // Each vertex as (line point, offset along t, n, b).
  const local = ps.map((p) => {
    let best = 0;
    for (let i = 1; i < RIB_N; i++) if (p.distanceToSquared(line[i]) < p.distanceToSquared(line[best])) best = i;
    const o = p.clone().sub(line[best]);
    return [best, o.dot(fr[best].t), o.dot(fr[best].n), o.dot(fr[best].b)];
  });
  const radius = local.reduce((a, l) => a + Math.hypot(l[2], l[3]), 0) / local.length;
  return { g, line, local, radius, head: ps[head] };
}

const scanned = new Map<number, ReturnType<typeof ribModel>>();
for (const r of mountRibs) {
  if (r.side === "L" && r.k >= 4 && r.k <= 9) scanned.set(r.k, ribModel(components(get(labels[r.l]))[0]));
  if (r.side === "R" && r.k === 13) scanned.set(13, ribModel(components(mirror(get(labels[r.l])))[0]));
}
if ([4, 5, 6, 7, 8, 9, 13].some((k) => !scanned.has(k))) throw new Error(`rib templates: ${[...scanned.keys()]}`);
// Foveae in the atlas frame, moved by the mean offset of the scanned heads.
const fovea = (k: number) => new Vector3(midX(FOVEAE[k - 1]), 0.754 + (FOVEAE[k - 1] + 0.247) * 0.168 + 0.03, FOVEAE[k - 1]).applyMatrix4(toMedian);
const headShift = mean([4, 5, 6, 7, 8, 9].map((k) => scanned.get(k)!.head.clone().sub(fovea(k))));
for (const [k, r] of scanned) console.log(`rib ${k} template: head ${r.head.toArray().map((x) => x.toFixed(3))}, centreline ${(lengthOf(r.line) * 100).toFixed(0)} cm`);
const rib7 = lengthOf(scanned.get(7)!.line);
const ribs = Array.from({ length: 13 }, (_, i) => {
  const k = i + 1;
  if (k >= 4 && k <= 9) {
    const r = scanned.get(k)!;
    return { g: r.g, line: r.line, radius: r.radius };
  }
  const [a, b, w] = k < 4 ? [4, 4, 0] : k < 13 ? [9, 13, (k - 9) / 4] : [13, 13, 0];
  const A = scanned.get(a)!;
  const B = scanned.get(b)!;
  const shape = A.line.map((p, j) => p.clone().sub(A.line[0]).lerp(B.line[j].clone().sub(B.line[0]), w));
  const scale = (RIB_LENGTH[k] * rib7) / lengthOf(shape);
  const head = k === 13 ? B.head : fovea(k).add(headShift);
  const line = shape.map((p) => p.multiplyScalar(scale).add(head));
  const fr = lineFrames(line, ribHint);
  const src = w < 0.5 ? A : B;
  const thick = Math.sqrt(scale);
  const position = new Float32Array(src.local.length * 3);
  src.local.forEach(([j, ot, on, ob], n) => {
    const f = fr[j];
    line[j].clone().addScaledVector(f.t, ot * scale).addScaledVector(f.n, on * thick).addScaledVector(f.b, ob * thick).toArray(position, n * 3);
  });
  return { g: { position, index: src.g.index.slice() } as Geometry, line, radius: src.radius * thick };
});
console.log(`ribs: lengths ${ribs.map((r) => (lengthOf(r.line) * 100).toFixed(0)).join(" ")} cm`);

// Tube along a Hermite curve, radius from r0 to r1 (0 closes the end).
function tube(p0: V, t0: V, p1: V, t1: V, r0: number, r1: number, samples = 16, sides = 10): Geometry & { line: V[] } {
  const line: V[] = [];
  for (let j = 0; j <= samples; j++) {
    const u = j / samples;
    line.push(
      p0.clone().multiplyScalar(2 * u ** 3 - 3 * u ** 2 + 1)
        .addScaledVector(t0, u ** 3 - 2 * u ** 2 + u)
        .addScaledVector(p1, -2 * u ** 3 + 3 * u ** 2)
        .addScaledVector(t1, u ** 3 - u ** 2),
    );
  }
  const fr = lineFrames(line, Math.abs(t0.clone().normalize().y) > 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0));
  const position: number[] = [];
  const index: number[] = [];
  line.forEach((c, j) => {
    const r = r0 + (r1 - r0) * (j / samples);
    for (let k = 0; k < sides; k++) {
      const angle = (k / sides) * Math.PI * 2;
      c.clone().addScaledVector(fr[j].n, Math.cos(angle) * r).addScaledVector(fr[j].b, Math.sin(angle) * r).toArray(position, position.length);
    }
  });
  for (let j = 0; j < samples; j++)
    for (let k = 0; k < sides; k++) {
      const p = j * sides + k;
      const q = j * sides + ((k + 1) % sides);
      index.push(p, p + sides, q, q, p + sides, q + sides);
    }
  return { position: new Float32Array(position), index: new Uint32Array(index), line };
}

// ---------------------------------------------------------------------------
// Sternum: the mount keeps the manubrium and four sternebrae. The sixth and
// seventh are copies of the last one continued along the sternum, and the
// xiphoid cartilage a thin plate after them (modeled).

const sternum = (() => {
  const st = median.get("sternum")!;
  const { axes, center } = pca(points(st, 6000));
  const axis = axes[0].clone().multiplyScalar(Math.sign(axes[0].z));
  const along = points(st, 6000).map((p) => p.dot(axis));
  const [lo, hi] = [Math.min(...along), Math.max(...along)];
  const seg = (hi - lo) / 5;
  const last = subset(st, (c) => c.dot(axis) > hi - seg);
  const copies = [1, 2].map((i) => transform(last, new Matrix4().makeTranslation(...(axis.clone().multiplyScalar(seg * i * 1.04).toArray() as [number, number, number]))));
  const tip = center.clone().addScaledVector(axis, hi - center.dot(axis) + seg * 2.4);
  const n = new Vector3(0, 1, 0).sub(axis.clone().multiplyScalar(axis.y)).normalize();
  const xiphoid = transform(sphere([0, 0, 0], 1), new Matrix4().makeTranslation(tip.x, tip.y, tip.z).multiply(new Matrix4().makeBasis(n.clone().cross(axis), n, axis)).multiply(new Matrix4().makeScale(0.022, 0.004, seg * 0.6)));
  const at = (f: number) => center.clone().addScaledVector(axis, lo + (hi - lo + seg * 2.08) * f - center.dot(axis));
  return { g: merge([st, ...copies, xiphoid]), at };
})();
median.set("sternum", sternum.g);

// Costal cartilages, part of each rib: ribs 1-8 reach the sternum (1 on the
// manubrium, 2-8 at the sternebral joints), 9-12 join the cartilage in front
// to form the costal arch, 13 ends free.
const cartilages: (Geometry & { line: V[] })[] = [];
ribs.forEach((rib, i) => {
  const k = i + 1;
  const end = rib.line.at(-1)!;
  const dir = end.clone().sub(rib.line.at(-4)!).normalize();
  const r = rib.radius * 0.9;
  let target: V;
  if (k <= 8) target = sternum.at(k === 1 ? 0.03 : (k - 1) / 7.6).add(new Vector3(-0.014, 0.004, 0));
  else if (k <= 12) target = cartilages[i - 1].line[Math.round(cartilages[i - 1].line.length * 0.65)];
  else target = end.clone().addScaledVector(dir, 0.03).add(new Vector3(0.006, -0.01, 0.01));
  const reach = end.distanceTo(target);
  const inward = k <= 8 ? new Vector3(1, -0.3, -0.4).normalize() : target.clone().sub(end).normalize();
  cartilages.push(tube(end.clone().addScaledVector(dir, -r), dir.clone().multiplyScalar(reach), target, inward.multiplyScalar(reach * 0.6), r, k === 13 ? 0 : r * 0.8));
});
ribs.forEach((r, i) => (r.g = merge([r.g, cartilages[i]])));

// ---------------------------------------------------------------------------
// Tail: the mount keeps Cd1-Cd2. Cd3-Cd18 are modeled as rods (illustrative)
// along a tail that runs caudally over the ischial tubers and hangs down to
// the level of the hocks, from 3.5 cm long and 2.4 cm thick to 2 cm and 1 cm.

{
  const cd2 = median.get("vertebrae-caudal.cd2")!;
  const from = end(cd2, new Vector3(0, 0, 1), 0.05).setX(0);
  const behind = bounds(left.get("os-coxae")!).max.z + 0.03;
  const hock = end(left.get("tarsus")!, new Vector3(0, 1, 0), 0.05).y;
  const path = resample(
    Array.from({ length: 40 }, (_, j) => {
      const u = j / 39;
      const bend = Math.min(1, u * 3);
      return new Vector3(0, from.y - 0.04 * bend - (from.y - 0.04 - hock) * Math.max(0, (u - 0.25) / 0.75) ** 1.1, from.z + (behind - from.z) * Math.sin((bend * Math.PI) / 2));
    }),
    400,
  );
  const total = lengthOf(path);
  const arc = (d: number) => path[Math.min(path.length - 1, Math.round((d / total) * (path.length - 1)))];
  let s = 0;
  for (let i = 3; i <= 18; i++) {
    const f = (i - 3) / 15;
    const len = 0.035 - 0.015 * f;
    const a = arc(s + 0.004);
    const b = arc(s + len);
    s += len + 0.004;
    median.set(`vertebrae-caudal.cd${i}`, capsule(a.toArray() as [number, number, number], b.toArray() as [number, number, number], 0.012 - 0.007 * f));
  }
}

// Floor at y = 0.
{
  const drop = new Matrix4().makeTranslation(0, -floorY, 0);
  for (const map of [median, left]) for (const [key, g] of map) map.set(key, transform(g, drop));
  for (const r of ribs) r.g = transform(r.g, drop);
}

const model = createModel("cow.skeletal", [0.91, 0.89, 0.83, 1]);
for (const [key, g] of median) model.add(meshKey(`cow.skeletal.${key}`), g, key === "skull" ? 60000 : key === "mandible" ? 20000 : 4000);
ribs.forEach((r, i) => {
  model.add(meshKey(`cow.skeletal.ribs.${i + 1}.L`), r.g, 3000);
  model.add(meshKey(`cow.skeletal.ribs.${i + 1}.R`), mirror(r.g), 3000);
});
for (const [key, g] of left) {
  model.add(meshKey(`cow.skeletal.${key}.L`), g, 9000);
  model.add(meshKey(`cow.skeletal.${key}.R`), mirror(g), 9000);
}
await model.write(OUT);
