/**
 * Builds public/models/dog/skeletal.glb. Sources:
 * - Massey University "3D Dog Bone Project: Partial Dog Skeleton" (CC BY-SA /
 *   CC BY-NC, Sketchfab): the long bones, hip bone, scapula, skull, atlas, C7,
 *   L1 and ribs 1, 4, 9 and 13.
 * - Single-bone scans: manubrium sterni (LMU Munich, CC BY 4.0), hyoid with
 *   larynx (VASAnatomy, CC BY 4.0), os penis (SusanElaineJones, CC BY 4.0).
 * - Greyhound pelvic limb CT (Hutchinson, figshare, CC BY 4.0), meshed by
 *   scripts/ct/greyhound_hindlimb.py: patella, tarsus, metatarsus, pelvic
 *   phalanges, sacrum and caudal vertebrae.
 * - "Front leg of a dog" (Scan the World, Zenodo, CC BY-NC-SA 4.0), split by
 *   scripts/ct/stw_front_leg.py: carpus, metacarpus, thoracic phalanges.
 * The other vertebrae, ribs 2-3, 5-8 and 10-12 and sternebrae 2-8 are modeled
 * by deforming those scans (fidelity "modeled"); costal cartilages are tubes.
 *
 * Downloads go to .cache/models/ (Sketchfab needs SKETCHFAB_TOKEN in
 * .env.local); the Python scripts run with .venv/bin/python when their output
 * is missing. The Massey file contains left-side scans placed in anatomical
 * position, in millimetres, animal facing +Z with its left side at +X. Other
 * sources are registered on the Massey bones or placed by hand below.
 *
 * Output conventions: metres, Y up, floor at y=0, animal faces -Z, animal's
 * left side is -X. One mesh per structure (or per vertebra, rib or sternebra)
 * named with meshKey(); right-side bones are mirrored copies.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getBounds } from "@gltf-transform/core";
import { Matrix4, Quaternion, Vector3 } from "three";
import { meshKey } from "../lib/content/mesh";
import { bake, bounds, capsule, createModel, download, io, merge, mirror, readPrims, sphere, transform, type Geometry, type Prim, type Vec } from "./lib/glb";

const OUT = path.join(process.cwd(), "public", "models", "dog", "skeletal.glb");

const sources = {
  massey: { uid: "65a6c5db1c4c477aba475af5d86d59a5", file: "massey-partial-dog-skeleton.glb" },
  manubrium: { uid: "3bff8f87a70f471588de81c0c83d4300", file: "lmu-manubrium-dog.glb" },
  hyoid: { uid: "d897279031194df28f3baa1e1f5fbef8", file: "vasanatomy-hyoid-larynx-dog.glb" },
  baculum: { uid: "5b9ab71b1e4f43b0a70a2e9a86f177ac", file: "sketchfab-dog-baculum.glb" },
};

// Node name prefixes inside the source file -> structure id. The four rib
// scans (ribs 1, 4, 9 and 13) are handled in the ribs section below.
const bones = [
  { id: "dog.skeletal.os-coxae", nodes: ["Hip_bone_"], paired: true, tris: 11000 },
  { id: "dog.skeletal.femur", nodes: ["Femur_"], paired: true, tris: 11000 },
  { id: "dog.skeletal.tibia", nodes: ["Left_tibia_"], paired: true, tris: 11000 },
  { id: "dog.skeletal.fibula", nodes: ["Left_fibula_"], paired: true, tris: 6000 },
  { id: "dog.skeletal.scapula", nodes: ["Scapula_"], paired: true, tris: 11000 },
  { id: "dog.skeletal.humerus", nodes: ["Left_humerus_"], paired: true, tris: 11000 },
  { id: "dog.skeletal.radius", nodes: ["Lefr_radius_"], paired: true, tris: 10000 },
  { id: "dog.skeletal.ulna", nodes: ["Left__ulna_"], paired: true, tris: 10000 },
  { id: "dog.skeletal.atlas", nodes: ["C1_C1_"], paired: false, tris: 9000 },
  { id: "dog.skeletal.vertebra-c7", nodes: ["C7_T7_"], paired: false, tris: 8000 },
  { id: "dog.skeletal.vertebra-l1", nodes: ["L1_L1_"], paired: false, tris: 8000 },
  { id: "dog.skeletal.skull", nodes: ["Dog_upper_skull_"], paired: false, tris: 30000 },
  { id: "dog.skeletal.mandible", nodes: ["Dog_lower_jaw_"], paired: false, tris: 20000 },
];

// Centroid of the vertices in the top or bottom 10% of a bone's height.
function endCenter(g: Geometry, end: "top" | "bottom") {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 1; i < g.position.length; i += 3) {
    min = Math.min(min, g.position[i]);
    max = Math.max(max, g.position[i]);
  }
  const limit = end === "top" ? max - (max - min) * 0.1 : min + (max - min) * 0.1;
  const c = new Vector3();
  let n = 0;
  for (let i = 0; i < g.position.length; i += 3) {
    const y = g.position[i + 1];
    if (end === "top" ? y >= limit : y <= limit) {
      c.add(new Vector3(g.position[i], y, g.position[i + 2]));
      n++;
    }
  }
  return c.divideScalar(n);
}

// Centroid of the vertices in the front (-Z) or back (+Z) 10% of a bone's length.
function endCenterZ(g: Geometry, end: "front" | "back") {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 2; i < g.position.length; i += 3) {
    min = Math.min(min, g.position[i]);
    max = Math.max(max, g.position[i]);
  }
  const limit = end === "back" ? max - (max - min) * 0.1 : min + (max - min) * 0.1;
  const c = new Vector3();
  let n = 0;
  for (let i = 0; i < g.position.length; i += 3) {
    const z = g.position[i + 2];
    if (end === "back" ? z >= limit : z <= limit) {
      c.add(new Vector3(g.position[i], g.position[i + 1], z));
      n++;
    }
  }
  return c.divideScalar(n);
}

// Scales and rotates a loose scan, then moves its bounding-box centre to `anchor`.
function placed(prims: Prim[], scale: number, rotation: Matrix4, anchor: Vec): Geometry {
  const g = bake(prims, rotation.clone().multiply(new Matrix4().makeScale(scale, scale, scale)));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < g.position.length; i += 3) {
    for (let d = 0; d < 3; d++) {
      min[d] = Math.min(min[d], g.position[i + d]);
      max[d] = Math.max(max[d], g.position[i + d]);
    }
  }
  for (let i = 0; i < g.position.length; i += 3) {
    for (let d = 0; d < 3; d++) g.position[i + d] += anchor[d] - (min[d] + max[d]) / 2;
  }
  return g;
}

const masseyFile = await download(sources.massey);
const massey = await io.read(masseyFile);
const leaves = massey.getRoot().listNodes().filter((n) => n.getMesh());
const silhouette = leaves.find((n) => n.getName().startsWith("low_poly_doggy"))!;
const floorMm = getBounds(silhouette).min[1];
// Massey frame -> atlas frame: floor to y=0, rotate 180° around Y, mm -> m.
const masseyPost = new Matrix4().makeScale(0.001, 0.001, 0.001).multiply(new Matrix4().makeRotationY(Math.PI)).multiply(new Matrix4().makeTranslation(0, -floorMm, 0));

const model = createModel("dog.skeletal", [0.91, 0.89, 0.83, 1]);
const addMesh = model.add;

const scanned = new Map<string, Geometry>();
for (const bone of bones) {
  const prims = leaves
    .filter((n) => bone.nodes.some((p) => n.getName().startsWith(p)))
    .flatMap((n) => n.getMesh()!.listPrimitives().map((prim) => ({ prim, world: new Matrix4().fromArray(n.getWorldMatrix()) })));
  if (prims.length === 0) throw new Error(`no source nodes for ${bone.id}`);
  const g = bake(prims, masseyPost);
  scanned.set(bone.id, g);
  if (!bone.paired) {
    addMesh(meshKey(bone.id), g, bone.tris);
    continue;
  }
  addMesh(meshKey(`${bone.id}.L`), g, bone.tris);
  addMesh(meshKey(`${bone.id}.R`), mirror(g), bone.tris);
}

// Single-bone scans, moved into the atlas frame by hand. Anchor points come
// from the scanned bones so they follow the skeleton if it changes.
const ribOne = bake(leaves.filter((n) => n.getName().startsWith("R1_R13_")).flatMap((n) => n.getMesh()!.listPrimitives().map((prim) => ({ prim, world: new Matrix4().fromArray(n.getWorldMatrix()) }))), masseyPost);
const sternalEnd = endCenter(ribOne, "bottom");
const mandible = scanned.get("dog.skeletal.mandible")!;
const jawAngle = endCenterZ(mandible, "back");
let jawVentral = Infinity;
for (let i = 1; i < mandible.position.length; i += 3) jawVentral = Math.min(jawVentral, mandible.position[i]);

// Manubrium: long axis X, cranial end -X, dorsal +Y, units 0.01 mm. Turned so
// cranial is -Z, tilted cranodorsally, centred one costal cartilage below the
// sternal end of the first rib.
const manubrium = placed(await readPrims(await download(sources.manubrium), () => true), 0.00001, new Matrix4().makeRotationX(0.55).multiply(new Matrix4().makeRotationY(-Math.PI / 2)), [0, sternalEnd.y - 0.016, sternalEnd.z - 0.002]);
addMesh(meshKey("dog.skeletal.manubrium"), manubrium, 8000);
// Hyoid + larynx plastinate: metres, animal faces +Z, Y up. Sits below the
// ventral border of the mandible, from the mandibular angle caudally. The
// Massey head is raised with the mandibular angle 7 mm from the axis, so the
// larynx overlaps C3–C5; fixing that needs the head and neck re-posed.
const hyoid = placed(await readPrims(await download(sources.hyoid), () => true), 1, new Matrix4().makeRotationY(Math.PI), [0, jawVentral, jawAngle.z + 0.038]);

// ---------------------------------------------------------------------------
// Geometry helpers for registering and deforming scans.

type V = Vector3;

function points(g: Geometry, max = Infinity): V[] {
  const n = g.position.length / 3;
  const step = Math.max(1, Math.floor(n / max));
  const out: V[] = [];
  for (let i = 0; i < n; i += step) out.push(new Vector3().fromArray(g.position, i * 3));
  return out;
}

function mean(ps: V[]) {
  return ps.reduce((a, p) => a.add(p), new Vector3()).divideScalar(ps.length);
}

// Eigen decomposition of a symmetric matrix (Jacobi), eigenvalues descending.
function eigen(a: number[][]) {
  const n = a.length;
  const m = a.map((r) => r.slice());
  const v: number[][] = m.map((_, i) => m.map((_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(m[p][q]) < 1e-15) continue;
        const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const mkp = m[k][p];
          const mkq = m[k][q];
          m[k][p] = c * mkp - s * mkq;
          m[k][q] = s * mkp + c * mkq;
        }
        for (let k = 0; k < n; k++) {
          const mpk = m[p][k];
          const mqk = m[q][k];
          m[p][k] = c * mpk - s * mqk;
          m[q][k] = s * mpk + c * mqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  return m
    .map((_, i) => ({ value: m[i][i], vector: v.map((r) => r[i]) }))
    .sort((x, y) => y.value - x.value);
}

// Principal axes of a point cloud (longest first).
function pca(ps: V[]) {
  const c = mean(ps);
  const cov = [0, 1, 2].map(() => [0, 0, 0]);
  for (const p of ps) {
    const d = [p.x - c.x, p.y - c.y, p.z - c.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j];
  }
  return { center: c, axes: eigen(cov).map((e) => new Vector3(...e.vector).normalize()) };
}

// Best rotation + translation (+ uniform scale) mapping src[i] onto dst[i] (Horn's quaternion method).
function fit(src: V[], dst: V[], withScale = false) {
  const cs = mean(src);
  const cd = mean(dst);
  const s = [0, 1, 2].map(() => [0, 0, 0]);
  let ss = 0;
  for (let i = 0; i < src.length; i++) {
    const a = src[i].clone().sub(cs);
    const b = dst[i].clone().sub(cd);
    ss += a.lengthSq();
    const av = [a.x, a.y, a.z];
    const bv = [b.x, b.y, b.z];
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) s[j][k] += av[j] * bv[k];
  }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = s;
  const n = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const [w, x, y, z] = eigen(n)[0].vector;
  const rot = new Matrix4().makeRotationFromQuaternion(new Quaternion(x, y, z, w).normalize());
  let scale = 1;
  if (withScale) {
    let num = 0;
    for (let i = 0; i < src.length; i++) num += dst[i].clone().sub(cd).dot(src[i].clone().sub(cs).applyMatrix4(rot));
    scale = num / ss;
  }
  const m = new Matrix4().makeTranslation(cd.x, cd.y, cd.z).multiply(rot).multiply(new Matrix4().makeScale(scale, scale, scale)).multiply(new Matrix4().makeTranslation(-cs.x, -cs.y, -cs.z));
  return m;
}

// Trimmed point-to-point ICP; returns the transform and the RMS of kept pairs.
function icp(src: V[], dst: V[], init: Matrix4, iterations = 40, keep = 0.8, withScale = false) {
  let m = init.clone();
  const dx = new Float64Array(dst.map((p) => p.x));
  const dy = new Float64Array(dst.map((p) => p.y));
  const dz = new Float64Array(dst.map((p) => p.z));
  let rms = Infinity;
  for (let it = 0; it < iterations; it++) {
    const pairs: { s: V; d: V; e: number }[] = [];
    for (const p of src) {
      const q = p.clone().applyMatrix4(m);
      let best = Infinity;
      let bi = 0;
      for (let j = 0; j < dx.length; j++) {
        const e = (dx[j] - q.x) ** 2 + (dy[j] - q.y) ** 2 + (dz[j] - q.z) ** 2;
        if (e < best) {
          best = e;
          bi = j;
        }
      }
      pairs.push({ s: p, d: dst[bi], e: best });
    }
    pairs.sort((a, b) => a.e - b.e);
    const kept = pairs.slice(0, Math.floor(pairs.length * keep));
    rms = Math.sqrt(kept.reduce((a, p) => a + p.e, 0) / kept.length);
    m = fit(kept.map((p) => p.s), kept.map((p) => p.d), withScale);
  }
  return { m, rms };
}

// Tries rotations about the long axis (and a mirror) as ICP starting points.
// `srcDir`/`dstDir` point from the far end to the end that must match.
function register(src: V[], dst: V[], srcDir: V, dstDir: V, mirrorToo: boolean, scale: number, valid: (m: Matrix4) => boolean = () => true, withScale = false) {
  const pd = pca(dst);
  const b = pd.axes[0].clone().multiplyScalar(Math.sign(pd.axes[0].dot(dstDir)));
  let best = { m: new Matrix4(), rms: Infinity, mirrored: false, pre: new Matrix4() };
  for (const mirrored of mirrorToo ? [false, true] : [false]) {
    // Mirror and scale first, so ICP only solves a rigid transform.
    const pre = new Matrix4().makeScale(mirrored ? -scale : scale, scale, scale);
    const ps = src.map((p) => p.clone().applyMatrix4(pre));
    const { center, axes } = pca(ps);
    const dir = srcDir.clone().applyMatrix4(new Matrix4().makeScale(mirrored ? -1 : 1, 1, 1));
    const a = axes[0].clone().multiplyScalar(Math.sign(axes[0].dot(dir)));
    for (let k = 0; k < 12; k++) {
      const init = new Matrix4()
        .makeTranslation(pd.center.x, pd.center.y, pd.center.z)
        .multiply(new Matrix4().makeRotationAxis(b, (k / 12) * Math.PI * 2))
        .multiply(new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(a, b)))
        .multiply(new Matrix4().makeTranslation(-center.x, -center.y, -center.z));
      const r = icp(ps, dst, init, 25);
      const m = r.m.clone().multiply(pre);
      if (r.rms < best.rms && valid(m)) best = { m: r.m, rms: r.rms, mirrored, pre };
    }
  }
  const refined = icp(src.map((p) => p.clone().applyMatrix4(best.pre)), dst, best.m, 40, 0.8, withScale);
  return { m: refined.m.clone().multiply(best.pre), rms: refined.rms, mirrored: best.mirrored };
}

function rotateAbout(pivot: V, axis: V, angle: number) {
  return new Matrix4()
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(new Matrix4().makeRotationAxis(axis.clone().normalize(), angle))
    .multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}

function extent(g: Geometry, axis: V) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < g.position.length; i += 3) {
    const d = g.position[i] * axis.x + g.position[i + 1] * axis.y + g.position[i + 2] * axis.z;
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return { lo, hi, length: hi - lo };
}

// Keeps the vertices whose projection on `axis` is within [lo, hi].
function slab(g: Geometry, axis: V, lo: number, hi: number): V[] {
  return points(g).filter((p) => {
    const d = p.dot(axis);
    return d >= lo && d <= hi;
  });
}

// ---------------------------------------------------------------------------
// Greyhound pelvic limb CT (Hutchinson, figshare, CC BY 4.0), meshed by
// scripts/ct/greyhound_hindlimb.py. Positions are CT millimetres.

const CT_OUT = path.join(process.cwd(), ".cache", "models", "greyhound-ct", "out");
if (!["ankledown", "toknee", "toankle"].every((k) => fs.existsSync(path.join(CT_OUT, `${k}.json`)))) {
  execFileSync(path.join(".venv", "bin", "python"), ["-I", path.join("scripts", "ct", "greyhound_hindlimb.py")], { stdio: "inherit" });
}

function readCt(series: string) {
  const index = JSON.parse(fs.readFileSync(path.join(CT_OUT, `${series}.json`), "utf8")) as { name: string; kind: string; offset: number; count: number }[];
  const bin = fs.readFileSync(path.join(CT_OUT, `${series}.bin`));
  const out = new Map<string, Geometry>();
  for (const e of index) {
    const g = out.get(e.name) ?? ({} as Geometry);
    const buf = bin.buffer.slice(bin.byteOffset + e.offset, bin.byteOffset + e.offset + e.count * 4) as ArrayBuffer;
    if (e.kind === "position") g.position = new Float32Array(buf).map((v) => v * 0.001);
    else g.index = new Uint32Array(buf);
    out.set(e.name, g);
  }
  return out;
}

const paw = readCt("ankledown");
const hip = readCt("toknee");
const leg = readCt("toankle");

// Scale: the Massey dog is smaller than the greyhound; use the tibia length.
const tibia = scanned.get("dog.skeletal.tibia")!;
const tibiaAxis = pca(points(tibia, 4000)).axes[0];
const ctTibiaAxis = pca(points(leg.get("tibia")!, 4000)).axes[0];
const scale = extent(tibia, tibiaAxis).length / extent(leg.get("tibia")!, ctTibiaAxis).length;
console.log(`greyhound -> Massey scale ${scale.toFixed(3)}`);

// Distal pelvic limb: register the CT distal tibia onto the Massey distal tibia.
const hock = endCenter(tibia, "bottom");
const ctTibia = paw.get("tibia")!;
const ctTarsusCenter = mean(points(paw.get("tarsus")!, 2000));
const ctAxis = pca(points(ctTibia, 3000)).axes[0];
const ctSeg = extent(ctTibia, ctAxis).length * scale;
const down = tibiaAxis.clone().multiplyScalar(-Math.sign(tibiaAxis.y));
const tibiaEnd = extent(tibia, down).hi;
const fibula = scanned.get("dog.skeletal.fibula")!;
const dst = [...slab(tibia, down, tibiaEnd - ctSeg, tibiaEnd + 1), ...slab(fibula, down, tibiaEnd - ctSeg, tibiaEnd + 1)].filter((_, i) => i % 3 === 0);
const src = [...points(ctTibia, 900), ...points(paw.get("fibula")!, 300)];
const ctDown = ctTarsusCenter.clone().sub(mean(points(ctTibia, 2000))).normalize();
// The distal tibia is nearly a cylinder, so anatomy picks the ICP solution:
// the calcaneal tuber points caudally and digit II (d) is medial to digit V (a).
const at = (k: string, m: Matrix4) => mean(points(paw.get(k)!, 500)).applyMatrix4(m);
const pawFit = register(src, dst, ctDown, down, true, scale, (m) => at("tuber", m).z > at("tarsus", m).z + 0.005 && at("d-p1", m).x > at("a-p1", m).x);
console.log(`distal tibia ICP rms ${(pawFit.rms * 1000).toFixed(2)} mm, mirrored ${pawFit.mirrored}`);

// Centroid of the `frac` of a mesh's vertices nearest to (or farthest from) a point.
function near(g: Geometry, to: V, frac = 0.1, far = false) {
  const ps = points(g, 4000).sort((a, b) => a.distanceToSquared(to) - b.distanceToSquared(to));
  const n = Math.max(1, Math.floor(ps.length * frac));
  return mean(far ? ps.slice(-n) : ps.slice(0, n));
}

// Forward tilt (radians) of a direction from straight down, in the sagittal plane.
const tilt = (d: V) => Math.atan2(-d.z, -d.y);

// Poses a chain of segments (each a list of mesh keys, proximal first) by
// rotating each segment and everything distal to it about its proximal joint
// in the sagittal plane, so the segment's axis has the target forward tilt.
function poseChain(parts: Map<string, Geometry>, chain: string[][], tilts: number[], hinge: V) {
  const seg = (keys: string[]) => merge(keys.map((k) => parts.get(k)!));
  for (let i = 1; i < chain.length; i++) {
    const prev = seg(chain[i - 1]);
    const cur = seg(chain[i]);
    const joint = near(prev, mean(points(cur, 2000))).add(near(cur, mean(points(prev, 2000)))).multiplyScalar(0.5);
    const tip = near(cur, joint, 0.1, true);
    const delta = tilts[i - 1] - tilt(tip.clone().sub(joint));
    const r = rotateAbout(joint, hinge, delta);
    for (const keys of chain.slice(i)) for (const k of keys) parts.set(k, transform(parts.get(k)!, r));
  }
}

const pawParts = ["tarsus", "mt-a", "mt-b", "mt-c", "mt-d", "a-p1", "a-p23", "b-p1", "b-p2", "b-p3", "c-p1", "c-p2", "c-p3", "d-p1", "d-p2", "d-p3"];
const pawPlaced = new Map(pawParts.map((k) => [k, transform(paw.get(k)!, pawFit.m)]));
const hinge = new Vector3(1, 0, 0);
const deg = (d: number) => (d * Math.PI) / 180;
// Hock: tilt the metatarsus so its distal end is slightly cranial (standing),
// then pose the digits: phalanx I slopes cranioventrally, II is nearly
// horizontal and the claw-bearing III points down to the ground. Phalanx I
// flattens until the digits clear the floor.
const metatarsals = ["mt-a", "mt-b", "mt-c", "mt-d"];
const digitChains = ["a", "b", "c", "d"].map((d) => (d === "a" ? [[`mt-${d}`], [`${d}-p1`], [`${d}-p23`]] : [[`mt-${d}`], [`${d}-p1`], [`${d}-p2`], [`${d}-p3`]]));
let pawPosed = pawPlaced;
{
  const all = merge(metatarsals.map((k) => pawPlaced.get(k)!));
  const r = rotateAbout(hock, hinge, deg(8) - tilt(near(all, hock, 0.1, true).sub(near(all, hock))));
  for (const k of pawParts) pawPlaced.set(k, transform(pawPlaced.get(k)!, r));
}
for (let p1 = 55; p1 <= 75; p1 += 2) {
  pawPosed = new Map(pawPlaced);
  for (const chain of digitChains) poseChain(pawPosed, chain, [deg(p1), deg(82), deg(45)], hinge);
  if (bounds(merge(pawParts.map((k) => pawPosed.get(k)!))).min.y > 0.001) break;
}

// Patella: register the CT distal femur onto the Massey distal femur and
// bring the CT patella along.
const femur = scanned.get("dog.skeletal.femur")!;
const ctFemur = hip.get("femur")!;
const ctPatellaCenter = mean(points(hip.get("patella")!, 1000));
const femurDown = (() => {
  const a = pca(points(femur, 4000)).axes[0];
  return a.multiplyScalar(-Math.sign(a.y));
})();
const ctFemurDown = (() => {
  const a = pca(points(ctFemur, 4000)).axes[0];
  return a.multiplyScalar(Math.sign(a.dot(ctPatellaCenter.clone().sub(mean(points(ctFemur, 4000))))));
})();
const femurEnd = extent(femur, femurDown);
const ctFemurEnd = extent(ctFemur, ctFemurDown);
const femurFit = register(
  slab(ctFemur, ctFemurDown, ctFemurEnd.hi - ctFemurEnd.length * 0.35, Infinity).filter((_, i, a) => i % Math.ceil(a.length / 1000) === 0),
  slab(femur, femurDown, femurEnd.hi - femurEnd.length * 0.35, Infinity).filter((_, i, a) => i % Math.ceil(a.length / 5000) === 0),
  ctFemurDown,
  femurDown,
  true,
  scale,
  (m) => ctPatellaCenter.clone().applyMatrix4(m).z < endCenter(femur, "bottom").z - 0.005,
);
console.log(`distal femur ICP rms ${(femurFit.rms * 1000).toFixed(2)} mm, mirrored ${femurFit.mirrored}`);
const patellaL = transform(hip.get("patella")!, femurFit.m);

// Sacrum and tail: register the CT hip bone onto the Massey hip bone.
const coxae = scanned.get("dog.skeletal.os-coxae")!;
const ctCoxae = hip.get("os-coxae")!;
const ctSacrumCenter = mean(points(hip.get("sacrum")!, 2000));
const ctCaudal = mean(points(hip.get("cd3")!, 500)).sub(ctSacrumCenter).normalize();
const pelvisFit = register(
  points(ctCoxae, 1200),
  points(coxae, 5000),
  ctCaudal,
  new Vector3(0, 0, 1),
  true,
  scale,
  (m) => Math.abs(ctSacrumCenter.clone().applyMatrix4(m).x) < 0.015 && ctSacrumCenter.clone().applyMatrix4(m).y > bounds(coxae).center.y,
);
console.log(`hip bone ICP rms ${(pelvisFit.rms * 1000).toFixed(2)} mm, mirrored ${pelvisFit.mirrored}`);
const sacrumGeo = transform(hip.get("sacrum")!, pelvisFit.m);
addMesh(meshKey("dog.skeletal.sacrum"), sacrumGeo, 10000);

// Rotation-minimizing frames (tangent, normal) along a polyline.
function frames(ps: V[], up: V) {
  const t = ps.map((_, i) => ps[Math.min(i + 1, ps.length - 1)].clone().sub(ps[Math.max(i - 1, 0)]).normalize());
  const n = [up.clone().sub(t[0].clone().multiplyScalar(up.dot(t[0]))).normalize()];
  for (let i = 1; i < ps.length; i++) n.push(n[i - 1].clone().applyQuaternion(new Quaternion().setFromUnitVectors(t[i - 1], t[i])));
  return t.map((ti, i) => new Matrix4().makeBasis(ti, n[i], ti.clone().cross(n[i])));
}

// Moves each segment from its place on the `from` polyline to the matching
// place on the `to` polyline, keeping its twist (rotation-minimizing frames).
function repose(parts: Geometry[], from: V[], to: V[]) {
  const up = new Vector3(0, 1, 0);
  const fa = frames(from, up);
  const fb = frames(to, up);
  return parts.map((g, i) =>
    transform(
      g,
      new Matrix4()
        .makeTranslation(to[i].x, to[i].y, to[i].z)
        .multiply(fb[i])
        .multiply(fa[i].clone().transpose())
        .multiply(new Matrix4().makeTranslation(-from[i].x, -from[i].y, -from[i].z)),
    ),
  );
}

// Tail: CT caudal vertebrae 1-8 from series HL1, 9-19 from HL1B (registered
// onto HL1 by the Python script), re-posed from the CT position (lying along
// the limb) to a relaxed hanging tail in the median plane. Spacing between
// vertebrae is kept; the curve starts along the sacrum and bends ventrally.
const caudals = Array.from({ length: 19 }, (_, i) => transform((i < 8 ? hip : leg).get(`cd${i + 1}`)!, pelvisFit.m));
const tailFrom = caudals.map((g) => mean(points(g, 1500)));
const tailTo = [tailFrom[0].clone().setX(0)];
{
  const t0 = tailFrom[1].clone().sub(tailFrom[0]);
  const start = Math.atan2(-t0.y, t0.z);
  const gaps = tailFrom.slice(1).map((p, i) => p.distanceTo(tailFrom[i]));
  const total = gaps.reduce((a, b) => a + b, 0);
  let s = 0;
  for (const gap of gaps) {
    s += gap / 2;
    const u = Math.min(1, s / (total * 0.6));
    const angle = start + (deg(78) - start) * u * u * (3 - 2 * u);
    s += gap / 2;
    tailTo.push(tailTo.at(-1)!.clone().add(new Vector3(0, -Math.sin(angle), Math.cos(angle)).multiplyScalar(gap)));
  }
}
const tailPosed = repose(caudals, tailFrom, tailTo);
tailPosed.forEach((g, i) => addMesh(meshKey(`dog.skeletal.vertebrae-caudal.cd${i + 1}`), g, i < 5 ? 2500 : 1200));
// ---------------------------------------------------------------------------
// Distal thoracic limb from the Scan the World "Front leg of a dog" CT surface
// (Zenodo 21487908, CC BY-NC-SA 4.0), split into bones by
// scripts/ct/stw_front_leg.py. Registered on the distal Massey radius + ulna,
// scaled by radius length, then posed like the pelvic paw.

const STW_OUT = path.join(process.cwd(), ".cache", "models", "stw-dog-front-leg", "out");
if (!fs.existsSync(path.join(STW_OUT, "stw.json"))) {
  execFileSync(path.join(".venv", "bin", "python"), ["-I", path.join("scripts", "ct", "stw_front_leg.py")], { stdio: "inherit" });
}
const manus = (() => {
  const index = JSON.parse(fs.readFileSync(path.join(STW_OUT, "stw.json"), "utf8")) as { name: string; kind: string; offset: number; count: number }[];
  const bin = fs.readFileSync(path.join(STW_OUT, "stw.bin"));
  const out = new Map<string, Geometry>();
  for (const e of index) {
    const g = out.get(e.name) ?? ({} as Geometry);
    const buf = bin.buffer.slice(bin.byteOffset + e.offset, bin.byteOffset + e.offset + e.count * 4) as ArrayBuffer;
    if (e.kind === "position") g.position = new Float32Array(buf);
    else g.index = new Uint32Array(buf);
    out.set(e.name, g);
  }
  return out;
})();
const radius = scanned.get("dog.skeletal.radius")!;
const ulna = scanned.get("dog.skeletal.ulna")!;
const carpusHome = endCenter(radius, "bottom");
// The two forearms differ too much for ICP, so the paw is placed by its own
// landmarks: the metacarpal axis gets a 12° cranial slope (standing), the
// palmar direction (towards the accessory carpal bone) points caudally and the
// proximal row of the carpus meets the distal end of the Massey radius. Scale
// comes from the distal width of radius + ulna. The scan is a right limb, so
// it is mirrored when that puts digit II medial.
function distalWidth(r: Geometry, u: Geometry, side: V) {
  const axis = pca(points(r, 4000)).axes[0];
  axis.multiplyScalar(-Math.sign(axis.y));
  const e = extent(r, axis);
  const both = [...slab(r, axis, e.hi - e.length * 0.08, Infinity), ...slab(u, axis, e.hi - e.length * 0.08, Infinity)];
  return Math.max(...both.map((p) => p.dot(side))) - Math.min(...both.map((p) => p.dot(side)));
}
const mean0 = (k: string) => mean(points(manus.get(k)!, 3000));
const stwCarpus = mean0("carpus");
const stwAxis = mean(["mc-2", "mc-3", "mc-4", "mc-5"].map((k) => near(manus.get(k)!, stwCarpus, 0.1, true))).sub(stwCarpus).normalize();
const stwBack = mean0("accessory").sub(stwCarpus);
stwBack.sub(stwAxis.clone().multiplyScalar(stwBack.dot(stwAxis))).normalize();
const stwSide = stwAxis.clone().cross(stwBack);
const manusScale = distalWidth(radius, ulna, new Vector3(1, 0, 0)) / distalWidth(manus.get("radius")!, manus.get("ulna")!, stwSide);
console.log(`scan the world -> Massey scale ${manusScale.toFixed(5)}`);
const manusParts = ["carpus", "mc-1", "mc-2", "mc-3", "mc-4", "mc-5", "dewclaw", "2-p1", "2-p2", "2-p3", "3-p1", "3-p2", "3-p3", "4-p1", "4-p2", "4-p3", "5-p1", "5-p23"];
const manusChains = [2, 3, 4, 5].map((d) => (d === 5 ? [[`mc-${d}`], [`${d}-p1`], [`${d}-p2`, `${d}-p23`].filter((k) => manus.has(k))] : [[`mc-${d}`], [`${d}-p1`], [`${d}-p2`], [`${d}-p3`]]));
function placeManus(scale: number, slope: number) {
  const toAxis = new Vector3(0, -Math.cos(slope), -Math.sin(slope));
  const toBack = new Vector3(0, -Math.sin(slope), Math.cos(slope));
  let fit = new Matrix4();
  for (const mirrored of [false, true]) {
    const mir = new Matrix4().makeScale(mirrored ? -1 : 1, 1, 1);
    const a = stwAxis.clone().applyMatrix4(mir);
    const b = stwBack.clone().applyMatrix4(mir);
    const rot = new Matrix4().makeBasis(toAxis, toBack, toAxis.clone().cross(toBack)).multiply(new Matrix4().makeBasis(a, b, a.clone().cross(b)).transpose());
    const m = rot.multiply(new Matrix4().makeScale(scale, scale, scale)).multiply(mir);
    const top = near(transform(manus.get("carpus")!, m), carpusHome.clone().add(new Vector3(0, 0.05, 0)));
    const candidate = new Matrix4().makeTranslation(carpusHome.x - top.x, carpusHome.y - top.y - 0.002, carpusHome.z - top.z).multiply(m);
    if (mean0("mc-2").applyMatrix4(candidate).x > mean0("mc-5").applyMatrix4(candidate).x) fit = candidate;
  }
  const parts = new Map(manusParts.map((k) => [k, transform(manus.get(k)!, fit)]));
  for (let p1 = 55; p1 <= 71; p1 += 2) {
    const posed = new Map(parts);
    for (const chain of manusChains) poseChain(posed, chain, [deg(p1), deg(82), deg(45)], hinge);
    if (bounds(merge(manusParts.map((k) => posed.get(k)!))).min.y > 0.001) return posed;
  }
  return null;
}
// The Massey forearm ends lower than the scan's proportions allow, so the
// pastern slopes 20° and the paw shrinks in 2% steps until the digits clear the floor.
let manusPosed: Map<string, Geometry> | null = null;
for (let f = 1; !manusPosed && f > 0.7; f -= 0.02) {
  manusPosed = placeManus(manusScale * f, deg(20));
  if (manusPosed) console.log(`thoracic paw at ${(f * 100).toFixed(0)}% of the forearm-width scale`);
}
if (!manusPosed) throw new Error("thoracic paw does not fit under the radius");
const carpusL = manusPosed.get("carpus")!;
const manusFinal = manusPosed;
const metacarpusL = merge(["mc-1", "mc-2", "mc-3", "mc-4", "mc-5"].map((k) => manusFinal.get(k)!));
const phalangesThoracicL = merge(manusParts.filter((k) => k.includes("-p") || k === "dewclaw").map((k) => manusFinal.get(k)!));

const tarsusL = pawPosed.get("tarsus")!;
const metatarsusL = merge(metatarsals.map((k) => pawPosed.get(k)!));
const phalangesL = merge(pawParts.filter((k) => k.includes("-p")).map((k) => pawPosed.get(k)!));
for (const side of ["L", "R"] as const) {
  const flip = (g: Geometry) => (side === "L" ? g : mirror(g));
  addMesh(meshKey(`dog.skeletal.patella.${side}`), flip(patellaL), 3000);
  addMesh(meshKey(`dog.skeletal.tarsus.${side}`), flip(tarsusL), 6000);
  addMesh(meshKey(`dog.skeletal.metatarsus.${side}`), flip(metatarsusL), 6000);
  addMesh(meshKey(`dog.skeletal.phalanges-pelvic.${side}`), flip(phalangesL), 7000);
  addMesh(meshKey(`dog.skeletal.carpus.${side}`), flip(carpusL), 6000);
  addMesh(meshKey(`dog.skeletal.metacarpus.${side}`), flip(metacarpusL), 6000);
  addMesh(meshKey(`dog.skeletal.phalanges-thoracic.${side}`), flip(phalangesThoracicL), 7000);
}

// ---------------------------------------------------------------------------
// Vertebral column. Axis, C3-C6, T1-T13 and L2-L7 are modeled by deforming
// the scanned C7 and L1 and placing them along a smooth curve through the
// scanned atlas, C7, L1 and the CT sacrum.

const smooth = (e0: number, e1: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return u * u * (3 - 2 * u);
};
// Dorsal direction for a caudally pointing tangent in the median plane.
const dorsalOf = (t: V) => new Vector3(0, t.z, -t.y).normalize();

// Local frame of a scanned vertebra: origin at the body centre, t caudal along
// the body, n dorsal, l = t x n. Heights are normalised to [0, 1].
function vertebraFrame(g: Geometry) {
  const ps = points(g);
  const b = bounds(g);
  const halfX = b.size.x / 2;
  const body = ps.filter((p) => p.y < b.min.y + b.size.y * 0.3 && Math.abs(p.x - b.center.x) < halfX * 0.3);
  const byZ = body.slice().sort((p, q) => p.z - q.z);
  const n20 = Math.floor(byZ.length * 0.2);
  const t = mean(byZ.slice(-n20)).sub(mean(byZ.slice(0, n20))).setX(0).normalize();
  const n = dorsalOf(t);
  const l = t.clone().cross(n);
  const center = mean(body);
  const local = (p: V) => {
    const d = p.clone().sub(center);
    return new Vector3(d.dot(t), d.dot(n), d.dot(l));
  };
  const loc = ps.map(local);
  const bodyLoc = body.map(local);
  const range = (vs: V[], k: "x" | "y" | "z") => [Math.min(...vs.map((v) => v[k])), Math.max(...vs.map((v) => v[k]))];
  const [bLo, bHi] = range(loc, "y");
  const [aLo, aHi] = range(bodyLoc, "x");
  const [cLo, cHi] = range(bodyLoc, "z");
  return { center, t, n, l, bLo, bHi, bodyLength: aHi - aLo, bodyHalfWidth: (cHi - cLo) / 2, aLo: range(loc, "x")[0], aHi: range(loc, "x")[1] };
}

type Shape = {
  length: number; // body length along the column
  size?: number; // uniform scale of height and width
  spine?: number; // spinous process height factor
  lean?: number; // caudal shear of the spinous process (per unit height)
  crest?: number; // craniocaudal widening of the spinous process (axis)
  transverse?: number; // lateral factor of the transverse processes
};

// Deforms a scanned vertebra in its local frame and places it on the column.
function modelVertebra(g: Geometry, f: ReturnType<typeof vertebraFrame>, spineStart: number, shape: Shape, at: V, t: V) {
  const n = dorsalOf(t);
  const l = t.clone().cross(n);
  const size = shape.size ?? 1;
  const ka = shape.length / f.bodyLength;
  const b0 = f.bLo + (f.bHi - f.bLo) * spineStart;
  const position = g.position.slice();
  const v = new Vector3();
  for (let i = 0; i < position.length; i += 3) {
    v.fromArray(position, i).sub(f.center);
    let a = v.dot(f.t);
    let b = v.dot(f.n);
    let c = v.dot(f.l);
    const u = (b - f.bLo) / (f.bHi - f.bLo);
    const w = smooth(spineStart - 0.05, spineStart + 0.08, u);
    const above = Math.max(0, b - b0);
    b += w * above * ((shape.spine ?? 1) - 1);
    a = a * ka * (1 + w * (shape.crest ?? 0) * smooth(0, f.bHi - b0, above)) + w * above * (shape.lean ?? 0) * (shape.spine ?? 1);
    const lateral = Math.abs(c) - f.bodyHalfWidth;
    if (lateral > 0) c = Math.sign(c) * (f.bodyHalfWidth + lateral * (1 + ((shape.transverse ?? 1) - 1) * smooth(0, 0.004, lateral) * (1 - smooth(0.5, 0.7, u))));
    const p = at.clone().addScaledVector(t, a).addScaledVector(n, b * size).addScaledVector(l, c * size);
    p.toArray(position, i);
  }
  return { position, index: g.index.slice() };
}

// Cubic Hermite curve through key points, sampled by arc length.
function curve(keys: { p: V; t: V; k?: number }[], samples = 400) {
  const pts: V[] = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    const chord = a.p.distanceTo(b.p);
    const ta = a.t.clone().multiplyScalar(chord * (a.k ?? 1));
    const tb = b.t.clone().multiplyScalar(chord * (b.k ?? 1));
    for (let j = 0; j < samples; j++) {
      const u = j / samples;
      const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
      const h10 = u ** 3 - 2 * u ** 2 + u;
      const h01 = -2 * u ** 3 + 3 * u ** 2;
      const h11 = u ** 3 - u ** 2;
      pts.push(a.p.clone().multiplyScalar(h00).addScaledVector(ta, h10).addScaledVector(b.p, h01).addScaledVector(tb, h11));
    }
  }
  pts.push(keys.at(-1)!.p.clone());
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const at = (x: number) => {
    let i = s.findIndex((v) => v >= x);
    if (i <= 0) i = x <= 0 ? 1 : pts.length - 1;
    const u = (x - s[i - 1]) / (s[i] - s[i - 1] || 1);
    return pts[i - 1].clone().lerp(pts[i], Math.min(1, Math.max(0, u)));
  };
  const tangent = (x: number) => at(x + 0.002).sub(at(x - 0.002)).normalize();
  // Arc length of the point nearest to p.
  const project = (p: V) => s[pts.reduce((bi, q, i) => (q.distanceToSquared(p) < pts[bi].distanceToSquared(p) ? i : bi), 0)];
  return { at, tangent, project, length: s.at(-1)! };
}

const atlasG = scanned.get("dog.skeletal.atlas")!;
const c7 = scanned.get("dog.skeletal.vertebra-c7")!;
const l1 = scanned.get("dog.skeletal.vertebra-l1")!;
const c7f = vertebraFrame(c7);
const l1f = vertebraFrame(l1);
const atlasPca = pca(points(atlasG, 4000));
const atlasCenter = atlasPca.center;
const atlasAxis = atlasPca.axes[2].clone().multiplyScalar(Math.sign(atlasPca.axes[2].dot(c7f.center.clone().sub(atlasCenter)))).setX(0).normalize();
const atlasHalf = extent(atlasG, atlasAxis).hi - atlasCenter.dot(atlasAxis);
// Cranial end of the sacral body: ventral half of its cranial-most midline vertices.
const sacrumHead = (() => {
  const ps = points(sacrumGeo).filter((p) => Math.abs(p.x) < 0.01);
  const z0 = Math.min(...ps.map((p) => p.z));
  const head = ps.filter((p) => p.z < z0 + 0.006);
  const ys = head.map((p) => p.y).sort((a, b) => a - b);
  return mean(head.filter((p) => p.y <= ys[Math.floor(ys.length / 2)])).setX(0);
})();
const sacrumAxis = tailFrom[0].clone().sub(sacrumHead).setX(0).normalize();
const column = curve([
  { p: atlasCenter.clone().setX(0), t: atlasAxis, k: 1.3 },
  { p: c7f.center.clone().setX(0), t: c7f.t, k: 1.3 },
  { p: l1f.center.clone().setX(0), t: l1f.t },
  { p: sacrumHead, t: sacrumAxis },
]);
const sAtlas = column.project(atlasCenter);
const sC7 = column.project(c7f.center);
const sL1 = column.project(l1f.center);
const sSacrum = column.length;

// Splits [s0, s1] into vertebrae with relative lengths `rel` and discs between.
function segments(s0: number, s1: number, rel: number[]) {
  const disc = 0.08;
  const unit = (s1 - s0) / (rel.reduce((a, b) => a + b, 0) + disc * (rel.length + 1));
  let s = s0 + disc * unit;
  return rel.map((r) => {
    const mid = s + (r * unit) / 2;
    s += r * unit + disc * unit;
    return { mid, length: r * unit };
  });
}

const vertebrae: { id: string; g: Geometry; tris: number }[] = [];
const c7Spine = 0.55;
const l1Spine = 0.6;
const place = (src: Geometry, f: ReturnType<typeof vertebraFrame>, spineStart: number, seg: { mid: number; length: number }, shape: Omit<Shape, "length">) =>
  modelVertebra(src, f, spineStart, { ...shape, length: seg.length }, column.at(seg.mid), column.tangent(seg.mid));

// Cervical: axis (with a long crest and a dens), C3-C6 with low spinous processes.
const neck = segments(sAtlas + atlasHalf, sC7 - c7f.bodyLength / 2, [1.9, 1.15, 1.1, 1.05, 0.95]);
{
  const axisG = place(c7, c7f, c7Spine, neck[0], { size: 1.05, spine: 0.75, crest: 1.4, transverse: 0.5 });
  const t = column.tangent(neck[0].mid);
  const head = column.at(neck[0].mid - neck[0].length / 2);
  const dens = capsule(head.clone().addScaledVector(t, 0.003).toArray() as Vec, head.clone().addScaledVector(t, -0.011).toArray() as Vec, 0.0045);
  vertebrae.push({ id: "dog.skeletal.axis", g: merge([axisG, dens]), tris: 4000 });
}
[0.2, 0.25, 0.32, 0.5].forEach((spine, i) =>
  vertebrae.push({ id: `dog.skeletal.vertebrae-cervical.c${i + 3}`, g: place(c7, c7f, c7Spine, neck[i + 1], { size: 1.02, spine, lean: -0.2 }), tris: 3000 }),
);

// Thoracic: T1-T10 from C7 (tall, caudally inclined spinous processes,
// short transverse processes); T11-T13 from L1 with small transverse processes.
const thorax = segments(sC7 + c7f.bodyLength / 2 + 0.002, sL1 - l1f.bodyLength / 2 - 0.002, [1, 0.97, 0.95, 0.93, 0.92, 0.92, 0.92, 0.93, 0.95, 0.98, 1.02, 1.07, 1.12]);
const thoracicSpine = [1.55, 1.55, 1.5, 1.42, 1.32, 1.2, 1.08, 0.96, 0.84, 0.72, 0.7, 0.75, 0.8];
const thoracicLean = [0.35, 0.4, 0.45, 0.5, 0.5, 0.5, 0.5, 0.45, 0.4, 0.3, 0, -0.15, -0.25];
thorax.forEach((seg, i) => {
  const id = `dog.skeletal.vertebrae-thoracic.t${i + 1}`;
  const g = i < 10 ? place(c7, c7f, c7Spine, seg, { size: 0.95, spine: thoracicSpine[i], lean: thoracicLean[i], transverse: 0.45 }) : place(l1, l1f, l1Spine, seg, { size: 0.95, spine: thoracicSpine[i], lean: thoracicLean[i], transverse: 0.3 });
  vertebrae.push({ id, g, tris: 3000 });
});

// Lumbar: L2-L7 from L1, longer bodies and transverse processes, L7 shorter.
const loins = segments(sL1 + l1f.bodyLength / 2 + 0.002, sSacrum, [1, 1.04, 1.07, 1.08, 1.06, 0.92]);
const lumbarTransverse = [1.05, 1.1, 1.15, 1.15, 1.1, 0.9];
const lumbarSpine = [1, 1, 0.98, 0.94, 0.86, 0.72];
loins.forEach((seg, i) => vertebrae.push({ id: `dog.skeletal.vertebrae-lumbar.l${i + 2}`, g: place(l1, l1f, l1Spine, seg, { size: 1 + i * 0.02, spine: lumbarSpine[i], transverse: lumbarTransverse[i] }), tris: 3000 }));
for (const v of vertebrae) addMesh(meshKey(v.id), v.g, v.tris);

addMesh(meshKey("dog.skeletal.hyoid"), hyoid, 15000);

// ---------------------------------------------------------------------------
// Ribs: 13 per side from the four scanned ribs (1, 4, 9, 13). Each scan is
// described along its centreline (geodesic distance from the head); a rib is
// rebuilt by laying the nearest scan's surface along a centreline blended
// between the two bracketing scans, with its head at the thoracic vertebrae.

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
function geodesic(g: Geometry, start: number) {
  const { pos, remap } = welded(g);
  const adj: number[][] = pos.map(() => []);
  for (let i = 0; i < g.index.length; i += 3) {
    const [a, b, c] = [remap[g.index[i]], remap[g.index[i + 1]], remap[g.index[i + 2]]];
    adj[a].push(b, c);
    adj[b].push(a, c);
    adj[c].push(a, b);
  }
  const dist = new Float64Array(pos.length).fill(Infinity);
  const heap: [number, number][] = [[0, remap[start]]];
  dist[remap[start]] = 0;
  while (heap.length) {
    let top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    } else top = last;
    const [d, v] = top;
    if (d > dist[v]) continue;
    for (const w of adj[v]) {
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
  const top = bounds(g).max.y - bounds(g).size.y * 0.3;
  let head = 0;
  ps.forEach((p, i) => {
    if (p.y > top && Math.abs(p.x) < Math.abs(ps[head].x)) head = i;
  });
  const d = geodesic(g, head);
  const dmax = Math.max(...d.filter(Number.isFinite));
  const bins: V[][] = Array.from({ length: 40 }, () => []);
  ps.forEach((p, i) => Number.isFinite(d[i]) && bins[Math.min(39, Math.floor((d[i] / dmax) * 40))].push(p));
  const raw = bins.filter((b) => b.length).map(mean);
  const smoothLine = raw.map((p, i) => mean(raw.slice(Math.max(0, i - 1), i + 2)));
  const line = resample(smoothLine, RIB_N);
  const fr = lineFrames(line, ribHint);
  // Each vertex as (u, offset along t, n, b) relative to its nearest line point.
  const local = ps.map((p) => {
    let best = 0;
    for (let i = 1; i < RIB_N; i++) if (p.distanceToSquared(line[i]) < p.distanceToSquared(line[best])) best = i;
    const o = p.clone().sub(line[best]);
    return [best, o.dot(fr[best].t), o.dot(fr[best].n), o.dot(fr[best].b)];
  });
  const radius = local.reduce((a, l) => a + Math.hypot(l[2], l[3]), 0) / local.length;
  return { g, line, local, radius };
}

const ribScans = new Map(
  ([[1, "R1_R13_"], [4, "R4_R4_"], [9, "R9_R1_"], [13, "R13_R9_"]] as const).map(([k, node]) => [
    k as number,
    ribModel(bake(leaves.filter((n) => n.getName().startsWith(node)).flatMap((n) => n.getMesh()!.listPrimitives().map((prim) => ({ prim, world: new Matrix4().fromArray(n.getWorldMatrix()) }))), masseyPost)),
  ]),
);
// Extra caudal slope (radians) given to each scan; the Massey ribs hang almost vertically.
const ribSlope = new Map([[1, 0], [4, deg(8)], [9, deg(16)], [13, 0]]);
const ribSource = (k: number) => (k === 1 ? 1 : k <= 6 ? 4 : k <= 11 ? 9 : 13);

// Head positions: rib k articulates between T(k-1) and Tk (T0 = C7) up to
// rib 10; ribs 11-13 only with their own vertebra.
const tSegs = [{ mid: sC7, length: c7f.bodyLength }, ...thorax];
function ribHead(k: number) {
  const s = k <= 10 ? (tSegs[k - 1].mid + tSegs[k - 1].length / 2 + tSegs[k].mid - tSegs[k].length / 2) / 2 : tSegs[k].mid - tSegs[k].length * 0.25;
  const t = column.tangent(s);
  return column.at(s).addScaledVector(dorsalOf(t), 0.004).add(new Vector3(-0.011, 0, 0));
}

function buildRib(k: number) {
  const keys = [1, 4, 9, 13];
  const b = keys.find((x) => x >= k)!;
  const a = keys.filter((x) => x <= k).at(-1)!;
  const w = a === b ? 0 : (k - a) / (b - a);
  const A = ribScans.get(a)!;
  const B = ribScans.get(b)!;
  const slope = ribSlope.get(a)! * (1 - w) + ribSlope.get(b)! * w;
  const tiltM = new Matrix4().makeRotationX(-slope);
  const head = ribHead(k);
  const line = A.line.map((p, i) => p.clone().sub(A.line[0]).lerp(B.line[i].clone().sub(B.line[0]), w).applyMatrix4(tiltM).add(head));
  const fr = lineFrames(line, ribHint);
  const src = ribScans.get(ribSource(k))!;
  const thick = (A.radius * (1 - w) + B.radius * w) / src.radius;
  const position = new Float32Array(src.local.length * 3);
  src.local.forEach(([i, ot, on, ob], j) => {
    const f = fr[i];
    line[i].clone().addScaledVector(f.t, ot).addScaledVector(f.n, on * thick).addScaledVector(f.b, ob * thick).toArray(position, j * 3);
  });
  return { g: { position, index: src.g.index.slice() } as Geometry, line, radius: A.radius * (1 - w) + B.radius * w };
}
const ribs = Array.from({ length: 13 }, (_, i) => buildRib(i + 1));

// Tube along a Hermite curve, radius interpolated from r0 to r1 (0 closes the end).
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
      const a = (k / sides) * Math.PI * 2;
      const p = c.clone().addScaledVector(fr[j].n, Math.cos(a) * r).addScaledVector(fr[j].b, Math.sin(a) * r);
      position.push(p.x, p.y, p.z);
    }
  });
  for (let j = 0; j < samples; j++)
    for (let k = 0; k < sides; k++) {
      const a = j * sides + k;
      const b = j * sides + ((k + 1) % sides);
      index.push(a, a + sides, b, b, a + sides, b + sides);
    }
  return { position: new Float32Array(position), index: new Uint32Array(index), line };
}

// ---------------------------------------------------------------------------
// Sternum: sternebrae 2-7 and the xiphoid process modeled from the manubrium
// scan, continuing caudoventrally from it to about the level of the elbow.

const manPca = pca(points(manubrium, 3000));
const manAxis = manPca.axes[0].clone().multiplyScalar(Math.sign(manPca.axes[0].z));
const manExt = extent(manubrium, manAxis);
const manLength = manExt.length;
const manTail = manPca.center.clone().addScaledVector(manAxis, manExt.hi - manPca.center.dot(manAxis));
const sternebra = manLength * 0.5;
const sternGap = sternebra * 0.15;
// The sternum descends caudoventrally from the thoracic inlet and levels out
// at the xiphoid, a little above the level of the elbow joint.
const sternSlopes = [38, 36, 32, 27, 20, 12, 0].map(deg);
const sternum: V[] = [manTail.clone().setX(0)];
const sternDirs: V[] = [];
for (let i = 0; i < 7; i++) {
  const len = i === 6 ? sternebra * 1.4 : sternebra;
  const d = new Vector3(0, -Math.sin(sternSlopes[i]), Math.cos(sternSlopes[i]));
  sternDirs.push(d);
  sternum.push(sternum.at(-1)!.clone().addScaledVector(d, sternGap + len));
}
const sternebrae: Geometry[] = [];
const manFrame = { t: manAxis, n: dorsalOf(manAxis) };
for (let i = 0; i < 7; i++) {
  const xiphoid = i === 6;
  const len = xiphoid ? sternebra * 1.4 : sternebra;
  const d = sternDirs[i];
  const start = sternum[i].clone().addScaledVector(d, sternGap);
  const mid = start.clone().addScaledVector(d, len / 2);
  const n = dorsalOf(d);
  const l = d.clone().cross(n);
  const kl = len / manLength;
  const position = manubrium.position.slice();
  const v = new Vector3();
  for (let j = 0; j < position.length; j += 3) {
    v.fromArray(position, j).sub(manPca.center);
    const a = v.dot(manFrame.t) * kl;
    const b = v.dot(manFrame.n) * (xiphoid ? 0.6 : 1.05);
    const c = v.dot(manFrame.t.clone().cross(manFrame.n)) * (xiphoid ? 1.05 : 1.1);
    mid.clone().addScaledVector(d, a).addScaledVector(n, b).addScaledVector(l, c).toArray(position, j);
  }
  const g: Geometry = { position, index: manubrium.index.slice() };
  // Xiphoid cartilage: a thin plate continuing the process caudally.
  if (xiphoid) {
    const plate = transform(sphere([0, 0, 0], 1), new Matrix4().makeTranslation(...(mid.clone().addScaledVector(d, len * 0.75).toArray() as Vec)).multiply(new Matrix4().makeBasis(l, n, d)).multiply(new Matrix4().makeScale(0.007, 0.0015, 0.009)));
    sternebrae.push(merge([g, plate]));
  } else sternebrae.push(g);
}
// Intersternebral junctions: index 0 = manubrium/S2 ... 6 = S7/xiphoid.
const junction = (i: number) => sternum[i].clone().addScaledVector(sternDirs[i], sternGap / 2);

// Costal cartilages, part of each rib: ribs 1-9 reach the sternum (1 on the
// manubrium, 2-8 at the intersternebral joints, 9 with 8), 10-12 join the
// cartilage in front to form the costal arch, 13 ends free.
const cartilages: (Geometry & { line: V[] })[] = [];
ribs.forEach((rib, i) => {
  const k = i + 1;
  const end = rib.line.at(-1)!;
  const dir = end.clone().sub(rib.line.at(-4)!).normalize();
  const r = rib.radius * 0.85;
  let target: V;
  if (k === 1) target = manPca.center.clone().addScaledVector(manAxis, -manLength * 0.15).add(new Vector3(-0.006, 0, 0));
  else if (k <= 9) target = junction(Math.min(k - 2, 6)).add(new Vector3(-0.005, 0, k === 9 ? 0.004 : 0));
  else if (k <= 12) target = cartilages[i - 1].line[Math.round(cartilages[i - 1].line.length * 0.7)];
  else target = end.clone().addScaledVector(dir, 0.014).add(new Vector3(0.003, -0.004, 0.004));
  const span = end.distanceTo(target);
  const inward = k <= 9 ? new Vector3(1, -0.2, -0.3).normalize() : target.clone().sub(end).normalize();
  const cart = tube(end.clone().addScaledVector(dir, -r), dir.clone().multiplyScalar(span), target, inward.multiplyScalar(span * 0.6), r, k === 13 ? 0 : r * 0.75);
  cartilages.push(cart);
});
ribs.forEach((r, i) => {
  const g = merge([r.g, cartilages[i]]);
  addMesh(meshKey(`dog.skeletal.ribs.${i + 1}.L`), g, 2200);
  addMesh(meshKey(`dog.skeletal.ribs.${i + 1}.R`), mirror(g), 2200);
});

// ---------------------------------------------------------------------------
// Os penis: "Dog Baculum" (SusanElaineJones, Sketchfab, CC BY 4.0). Arbitrary
// units, long axis +X with the base at +X and the urethral groove facing -Z.
// Placed in the median plane ventral to the caudal lumbar region (glans of
// the penis in the prepuce), base caudal, groove ventral, tip slightly lower.
{
  const bac = bake(await readPrims(await download(sources.baculum)), new Matrix4());
  const { center, axes } = pca(points(bac, 4000));
  const along = axes[0].clone().multiplyScalar(Math.sign(axes[0].x));
  const groove = new Vector3(0, 0, -1).sub(along.clone().multiplyScalar(-along.z)).normalize();
  const length = extent(bac, along).length;
  const tip = deg(10);
  const toAlong = new Vector3(0, Math.sin(tip), Math.cos(tip));
  const toGroove = dorsalOf(toAlong).negate();
  const k = 0.058 / length;
  const at = new Vector3(0, endCenter(femur, "bottom").y + 0.03, bounds(coxae).min.z - 0.035);
  const m = new Matrix4()
    .makeTranslation(at.x, at.y, at.z)
    .multiply(new Matrix4().makeBasis(toAlong, toGroove, toAlong.clone().cross(toGroove)))
    .multiply(new Matrix4().makeBasis(along, groove, along.clone().cross(groove)).transpose())
    .multiply(new Matrix4().makeScale(k, k, k))
    .multiply(new Matrix4().makeTranslation(-center.x, -center.y, -center.z));
  addMesh(meshKey("dog.skeletal.os-penis"), transform(bac, m), 4000);
}
sternebrae.forEach((g, i) => addMesh(meshKey(`dog.skeletal.sternum.${i === 6 ? "xiphoid" : `s${i + 2}`}`), g, 1500));

await model.write(OUT);
