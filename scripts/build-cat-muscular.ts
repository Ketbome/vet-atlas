/**
 * Builds public/models/cat/muscular.glb: procedural, illustrative cat muscles
 * shaped on the bones of public/models/cat/skeletal.glb (build that first).
 * Adapted from scripts/build-dog-muscular.ts; same 34 muscles.
 *
 * No openly licensed cat muscle models exist, so every muscle is modelled from
 * its anatomy. Origins and insertions are landmarks measured on the bone
 * meshes (extreme points, points at a fraction along a bone's long axis,
 * offsets in the bone's local frame). Limb muscles are tubes lofted along a
 * Catmull-Rom curve through origin, via-points and insertion, with an
 * elliptical cross-section whose width and thickness follow the muscle's
 * shape. Flat muscles are slabs; trunk and neck sheets lie on a parametric
 * body surface fitted to the vertebrae, ribs, sternum and pelvis. Vertices
 * that fall inside a bone or an already built (deeper) muscle are pushed out,
 * so muscles are built from deep to superficial.
 *
 * The bones are read scaled to the size of the dog (SCALE) and the muscles
 * scaled back on output, so offsets and thicknesses below are in that frame.
 * Feline differences from the dog:
 * - The head is carried low and flexed: head landmarks use a frame along the
 *   skull; the temporalis is large and fills the temporal fossa.
 * - The brachiocephalicus runs over the vestigial clavicle (not an obstacle).
 * - The biceps femoris arises from the ischiatic tuberosity only (no
 *   sacrotuberous ligament); the sartorius is one broad sheet.
 * - The trunk wall hugs the caudally slanted ribs.
 *
 * Other systems are read when present: the diaphragm is fitted between the
 * liver and the heart of visceral.glb, and vertices up to 6 mm (dog frame)
 * outside the skin of integumentary.glb are pulled inside it.
 *
 * --debug writes .cache/agent-out/cat-muscular-debug.glb instead, adding the
 * body surface, the landmarks and every tube's control points as small spheres.
 *
 * Output conventions as in scripts/lib/glb.ts: metres, Y up, animal faces -Z,
 * left side -X. Left-side muscles are built; right-side ones are mirrored.
 */
import fs from "node:fs";
import path from "node:path";
import { Matrix4, Vector3 } from "three";
import { meshKey } from "../lib/content/mesh";
import { createModel, merge, mirror, readAtlas, smoothNormals, sphere, transform, type Geometry } from "./lib/glb";

const SKELETON = path.join(process.cwd(), "public", "models", "cat", "skeletal.glb");
const VISCERA = path.join(process.cwd(), "public", "models", "cat", "visceral.glb");
const OUT = path.join(process.cwd(), "public", "models", "cat", "muscular.glb");
const DEBUG = process.argv.includes("--debug");

type V = Vector3;
type Profile = [number, number][];

const vec = (x: number, y: number, z: number) => new Vector3(x, y, z);
const AXES = {
  lat: vec(-1, 0, 0),
  med: vec(1, 0, 0),
  cra: vec(0, 0, -1),
  cau: vec(0, 0, 1),
  dor: vec(0, 1, 0),
  ven: vec(0, -1, 0),
};
type Dir = Partial<Record<keyof typeof AXES, number>>;
// Anatomical direction on the left side, e.g. dir({ cau: 1, lat: 0.5 }).
function dir(d: Dir) {
  const out = new Vector3();
  for (const [k, w] of Object.entries(d)) out.addScaledVector(AXES[k as keyof typeof AXES], w);
  return out.normalize();
}
const lerp = (a: V, b: V, t: number) => a.clone().lerp(b, t);
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Smooth 1D interpolation through knots [x, y] (cubic Hermite, Catmull-Rom tangents).
function prof(p: Profile, x: number) {
  if (x <= p[0][0]) return p[0][1];
  const n = p.length - 1;
  if (x >= p[n][0]) return p[n][1];
  let k = 0;
  while (p[k + 1][0] < x) k++;
  const [x0, y0] = p[k];
  const [x1, y1] = p[k + 1];
  const h = x1 - x0;
  const m0 = k > 0 ? ((y1 - p[k - 1][1]) / (x1 - p[k - 1][0])) * h : y1 - y0;
  const m1 = k + 2 <= n ? ((p[k + 2][1] - y0) / (p[k + 2][0] - x0)) * h : y1 - y0;
  const t = (x - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1;
}

// Catmull-Rom curve through `pts`, resampled to n points evenly spaced by arc length.
function spline(pts: V[], n: number): V[] {
  if (pts.length === 2) return Array.from({ length: n }, (_, i) => lerp(pts[0], pts[1], i / (n - 1)));
  const ext = [
    pts[0].clone().multiplyScalar(2).sub(pts[1]),
    ...pts,
    pts[pts.length - 1]
      .clone()
      .multiplyScalar(2)
      .sub(pts[pts.length - 2]),
  ];
  const dense: V[] = [];
  for (let s = 1; s < ext.length - 2; s++) {
    const [p0, p1, p2, p3] = [ext[s - 1], ext[s], ext[s + 1], ext[s + 2]];
    for (let k = 0; k < 24; k++) {
      const t = k / 24;
      const t2 = t * t;
      const t3 = t2 * t;
      dense.push(
        new Vector3()
          .addScaledVector(p0, -0.5 * t3 + t2 - 0.5 * t)
          .addScaledVector(p1, 1.5 * t3 - 2.5 * t2 + 1)
          .addScaledVector(p2, -1.5 * t3 + 2 * t2 + 0.5 * t)
          .addScaledVector(p3, 0.5 * t3 - 0.5 * t2),
      );
    }
  }
  dense.push(pts[pts.length - 1].clone());
  const acc = [0];
  for (let i = 1; i < dense.length; i++) acc.push(acc[i - 1] + dense[i].distanceTo(dense[i - 1]));
  const total = acc[acc.length - 1];
  const out: V[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const target = (total * i) / (n - 1);
    while (j < acc.length - 2 && acc[j + 1] < target) j++;
    const f = (target - acc[j]) / (acc[j + 1] - acc[j] || 1);
    out.push(lerp(dense[j], dense[j + 1], Math.min(1, Math.max(0, f))));
  }
  return out;
}

// ---------------------------------------------------------------- skeleton

// Every input is read scaled by SCALE (and the output scaled back), so the
// offsets and thicknesses below are in a dog-sized frame.
const SCALE = 1.7;
const grow = new Matrix4().makeScale(SCALE, SCALE, SCALE);
const shrink = new Matrix4().makeScale(1 / SCALE, 1 / SCALE, 1 / SCALE);
const readScaled = async (file: string) => new Map([...(await readAtlas(file))].map(([n, g]) => [n, transform(g, grow)]));
const atlas = await readScaled(SKELETON);
const isRight = (name: string) => name.endsWith("_R") || name.includes("_R_");

// Left-side (and midline) geometry of a skeletal structure, merged; undefined if absent.
function skel(slug: string): Geometry | undefined {
  const base = meshKey(`cat.skeletal.${slug}`);
  const parts = [...atlas].filter(([n]) => (n === base || n.startsWith(`${base}_`)) && !isRight(n)).map(([, g]) => g);
  return parts.length ? merge(parts) : undefined;
}

function points(g: Geometry) {
  const out: V[] = [];
  for (let i = 0; i < g.position.length; i += 3) out.push(vec(g.position[i], g.position[i + 1], g.position[i + 2]));
  return out;
}

// Eigenvectors of the covariance of a point set, largest variance first.
function pca(pts: V[]) {
  const c = new Vector3();
  for (const p of pts) c.add(p);
  c.divideScalar(pts.length);
  const m = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of pts) {
    const d = [p.x - c.x, p.y - c.y, p.z - c.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i][j] += d[i] * d[j];
  }
  // Jacobi rotations on the symmetric 3x3 matrix.
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 30; sweep++) {
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (Math.abs(m[p][q]) < 1e-15) continue;
      const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const cs = 1 / Math.sqrt(t * t + 1);
      const sn = t * cs;
      for (let k = 0; k < 3; k++) {
        const mkp = m[k][p];
        const mkq = m[k][q];
        m[k][p] = cs * mkp - sn * mkq;
        m[k][q] = sn * mkp + cs * mkq;
      }
      for (let k = 0; k < 3; k++) {
        const mpk = m[p][k];
        const mqk = m[q][k];
        m[p][k] = cs * mpk - sn * mqk;
        m[q][k] = sn * mpk + cs * mqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = cs * vkp - sn * vkq;
        v[k][q] = sn * vkp + cs * vkq;
      }
    }
  }
  const axes = [0, 1, 2].map((i) => ({
    val: m[i][i],
    vec: vec(v[0][i], v[1][i], v[2][i]).normalize(),
  }));
  axes.sort((a, b) => b.val - a.val);
  return { c, axes: axes.map((a) => a.vec) };
}

// A bone with a long axis from its proximal end `a` (t=0) to its distal end `b` (t=1).
class Bone {
  p: V[];
  a: V;
  b: V;
  ax: V;
  len: number;
  constructor(g: Geometry, hint: V) {
    this.p = points(g);
    const { c, axes } = pca(this.p);
    const ax = axes[0].dot(hint) < 0 ? axes[0].clone().negate() : axes[0].clone();
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of this.p) {
      const s = p.clone().sub(c).dot(ax);
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
    const ends = [new Vector3(), new Vector3()];
    const counts = [0, 0];
    for (const p of this.p) {
      const s = (p.clone().sub(c).dot(ax) - lo) / (hi - lo);
      if (s < 0.06) {
        ends[0].add(p);
        counts[0]++;
      }
      if (s > 0.94) {
        ends[1].add(p);
        counts[1]++;
      }
    }
    this.a = ends[0].divideScalar(counts[0]);
    this.b = ends[1].divideScalar(counts[1]);
    // Extend to the true extremes along the axis.
    this.a.addScaledVector(ax, -0.03 * (hi - lo));
    this.b.addScaledVector(ax, 0.03 * (hi - lo));
    this.ax = this.b.clone().sub(this.a).normalize();
    this.len = this.a.distanceTo(this.b);
  }
  t(p: V) {
    return p.clone().sub(this.a).dot(this.ax) / this.len;
  }
  at(t: number) {
    return lerp(this.a, this.b, t);
  }
  // Most extreme vertex in direction d among vertices with t in [t0, t1], pushed `off` along d.
  ext(d: Dir | V, t0 = 0, t1 = 1, off = 0) {
    const dv = d instanceof Vector3 ? d.clone().normalize() : dir(d);
    let best: V | undefined;
    let bestDot = -Infinity;
    for (const p of this.p) {
      const t = this.t(p);
      if (t < t0 || t > t1) continue;
      const s = p.dot(dv);
      if (s > bestDot) {
        bestDot = s;
        best = p;
      }
    }
    if (!best) throw new Error("empty bone range");
    return best.clone().addScaledVector(dv, off);
  }
  // Surface point on side d at level t (within a band of +-0.03), pushed `off` along d.
  surf(t: number, d: Dir | V, off = 0): V {
    // Widen the band on sparse meshes (schematic capsules).
    for (let band = 0.03; ; band *= 2) if (band > 0.5 || this.p.some((p) => Math.abs(this.t(p) - t) < band)) return this.ext(d, t - band, t + band, off);
  }
}

const required = (slug: string) => {
  const g = skel(slug);
  if (!g) throw new Error(`skeletal mesh ${slug} missing in ${SKELETON}`);
  return g;
};
const down = vec(0, -1, 0);
const scapula = new Bone(required("scapula"), down);
const humerus = new Bone(required("humerus"), down);
const radius = new Bone(required("radius"), down);
const ulna = new Bone(required("ulna"), down);
const femur = new Bone(required("femur"), down);
const tibia = new Bone(required("tibia"), down);
const coxae = new Bone(required("os-coxae"), vec(0, 0, 1));
const skull = new Bone(required("skull"), vec(0, 0, 1));
// Left half of the mandible, so its long axis runs along the left body (t=0 chin, t=1 condyle).
const mandible = (() => {
  const left = points(required("mandible")).filter((p) => p.x < 0);
  return new Bone({ position: Float32Array.from(left.flatMap((p) => p.toArray())), index: new Uint32Array() }, skull.ax);
})();
const tarsus = new Bone(required("tarsus"), down);
const metatarsus = new Bone(required("metatarsus"), down);
const patella = points(required("patella"));
const manubrium = points(required("sternum.s1"));
const ribPts = points(required("ribs")).filter((p) => p.x < 0);
const sternum = points(required("sternum"));
const carpusP = points(required("carpus"));
const metacarpus = new Bone(required("metacarpus"), down);
const phalangesThoracic = points(required("phalanges-thoracic"));

const boxOf = (pts: V[]) => {
  const min = vec(Infinity, Infinity, Infinity);
  const max = vec(-Infinity, -Infinity, -Infinity);
  for (const p of pts) {
    min.min(p);
    max.max(p);
  }
  return { min, max, center: lerp(min, max, 0.5) };
};
const centroid = (pts: V[]) => pts.reduce((c, p) => c.add(p), new Vector3()).divideScalar(pts.length);
const argmax = (pts: V[], d: Dir | V) => {
  const dv = d instanceof Vector3 ? d : dir(d);
  return pts.reduce((b, p) => (p.dot(dv) > b.dot(dv) ? p : b)).clone();
};

// ---------------------------------------------------------------- vertebral column

const LABELS = [
  ...Array.from({ length: 7 }, (_, i) => `c${i + 1}`),
  ...Array.from({ length: 13 }, (_, i) => `t${i + 1}`),
  ...Array.from({ length: 7 }, (_, i) => `l${i + 1}`),
  "s1",
  "s2",
  "s3",
];
const idx = (label: string) => {
  const i = LABELS.indexOf(label);
  if (i < 0) throw new Error(`unknown vertebra ${label}`);
  return i;
};

function vertebraMesh(label: string): Geometry | undefined {
  if (label === "c1") return skel("atlas") ?? undefined;
  if (label === "c2" && skel("axis")) return skel("axis");
  const re = new RegExp(`[-_]${label}$`);
  const parts = [...atlas].filter(([n]) => n.includes("vertebra") && re.test(n)).map(([, g]) => g);
  return parts.length ? merge(parts) : undefined;
}

type Station = { c: V; top: number };
const stations: Station[] = LABELS.map((label) => {
  if (label.startsWith("s")) return { c: new Vector3(), top: 0 };
  const g = vertebraMesh(label);
  if (!g) throw new Error(`vertebra ${label} missing in ${SKELETON}`);
  const b = boxOf(points(g));
  return { c: vec(0, b.center.y, b.center.z), top: b.max.y };
});
// Sacrum: S1-S3 at the sixths of its long axis.
{
  const sac = new Bone(required("sacrum"), vec(0, 0, 1));
  for (const [k, label] of ["s1", "s2", "s3"].entries()) {
    const t = (k + 0.5) / 3;
    const near = sac.p.filter((p) => Math.abs(sac.t(p) - t) < 0.25);
    const c = sac.at(t);
    stations[idx(label)] = { c: vec(0, c.y, c.z), top: Math.max(...near.map((p) => p.y)) };
  }
}

// Continuous position along the column: label (e.g. "t5") or fractional index.
const at = (i: number | string) => (typeof i === "string" ? idx(i) : i);
function column(i: number) {
  const pts = stations.map((s) => s.c);
  const k = Math.min(Math.max(Math.floor(i), 0), pts.length - 2);
  const t = i - k;
  const p0 = pts[Math.max(k - 1, 0)];
  const p1 = pts[k];
  const p2 = pts[k + 1];
  const p3 = pts[Math.min(k + 2, pts.length - 1)];
  const t2 = t * t;
  const t3 = t2 * t;
  return new Vector3()
    .addScaledVector(p0, -0.5 * t3 + t2 - 0.5 * t)
    .addScaledVector(p1, 1.5 * t3 - 2.5 * t2 + 1)
    .addScaledVector(p2, -1.5 * t3 + 2 * t2 + 0.5 * t)
    .addScaledVector(p3, 0.5 * t3 - 0.5 * t2);
}
const topAt = (i: number) =>
  prof(
    stations.map((s, k) => [k, s.top] as [number, number]),
    i,
  );

// ---------------------------------------------------------------- body surface

const ribBox = boxOf(ribPts);
const pubis = coxae.ext({ ven: 1, med: 0.3, cra: 0.2 });

// Ventral line of the trunk (sternum, then linea alba up to the pubis) as y(z).
const ventral: Profile = (() => {
  const b = boxOf(sternum);
  const out: Profile = [];
  for (let z = b.min.z; z <= b.max.z; z += 0.01) {
    const ys = sternum.filter((p) => Math.abs(p.z - z) < 0.008).map((p) => p.y);
    if (ys.length) out.push([z, Math.min(...ys) - 0.004]);
  }
  const last = out[out.length - 1];
  const span = pubis.z - last[0];
  out.push(
    [last[0] + span * 0.3, last[1] + (pubis.y - last[1]) * 0.35],
    [last[0] + span * 0.65, last[1] + (pubis.y - last[1]) * 0.8],
    [pubis.z, pubis.y - 0.006],
  );
  return out;
})();

// Half-width of the trunk wall as w(z): upper envelope of the ribs plus a
// muscle layer, then abdomen and pelvis.
const width: Profile = (() => {
  const zs: number[] = [];
  for (let z = ribBox.min.z; z <= ribBox.max.z + 1e-6; z += 0.01) zs.push(z);
  const raw = zs.map((z) => {
    const xs = ribPts.filter((p) => Math.abs(p.z - z) < 0.008).map((p) => -p.x);
    return xs.length > 10 ? Math.max(...xs) : NaN;
  });
  for (let i = 0; i < raw.length; i++) {
    if (!Number.isNaN(raw[i])) continue;
    let lo = i;
    let hi = i;
    while (lo > 0 && Number.isNaN(raw[lo])) lo--;
    while (hi < raw.length - 1 && Number.isNaN(raw[hi])) hi++;
    raw[i] = raw[lo] + ((raw[hi] - raw[lo]) * (i - lo)) / (hi - lo || 1);
  }
  // The cat's ribs slant caudally, so a narrow window and a plain average
  // keep the wall on the ribs.
  const out: Profile = raw.map((_, i) => {
    const win = raw.slice(Math.max(0, i - 1), i + 2);
    return [zs[i], win.reduce((a, b) => a + b, 0) / win.length + 0.005];
  });
  const maxRib = Math.max(...out.map((k) => k[1]));
  const tuberCoxae = coxae.ext({ cra: 1, ven: 0.6, lat: 0.4 });
  const last = out[out.length - 1][0];
  const lumbar = stations[idx("l4")].c.z;
  if (lumbar > last + 0.02) out.push([lumbar, maxRib * 0.92]);
  out.push([tuberCoxae.z, -tuberCoxae.x + 0.004], [pubis.z, -tuberCoxae.x - 0.004]);
  return out;
})();

// c: centre (halfway between dorsal and ventral outline), col: point on the
// vertebral column, u: dorsal direction, h: half height, a: half width, k: egg factor.
type Section = { c: V; col: V; u: V; h: number; a: number; k: number };
// Neck cross-sections (C1..C7): ventral thickness below the column and
// half-width, in metres; the dorsal side follows the outline of the neck.
const neck: [number, number, number][] = [
  [0, 0.034, 0.045],
  [2, 0.034, 0.042],
  [4, 0.03, 0.04],
  [6, 0.045, 0.042],
];
const sections = new Map<number, Section>();
function section(i: number): Section {
  const key = Math.round(i * 1000);
  const hit = sections.get(key);
  if (hit) return hit;
  const s = sectionAt(key / 1000);
  sections.set(key, s);
  return s;
}
// Dorsal outline of the neck, from above the atlas to the withers (T2),
// convex dorsally. Neck sections span from it to just ventral to the column.
let nape: V[] | undefined;
function neckTop(f: number) {
  if (!nape) {
    const tan = column(1).sub(column(0)).normalize();
    const p0 = column(0).addScaledVector(new Vector3().crossVectors(tan, vec(1, 0, 0)).normalize(), 0.03);
    const p2 = vec(0, topAt(idx("t2")) + 0.005, column(idx("t2")).z);
    nape = [p0, lerp(lerp(p0, p2, 0.5), vec(0, p0.y, p2.z), 0.55), p2];
  }
  const t = Math.min(Math.max(f, 0), 1);
  return nape[0].clone().multiplyScalar((1 - t) ** 2).addScaledVector(nape[1], 2 * t * (1 - t)).addScaledVector(nape[2], t * t);
}
function sectionAt(i: number): Section {
  const c = column(i);
  const n = (k: number) => prof(neck.map((r) => [r[0], r[k]] as [number, number]), i);
  const w = smoothstep(5.5, 8, i);
  // Neck: from the dorsal outline to below the column; trunk: transverse (vertical) planes.
  const tan = column(i + 0.5).sub(column(i - 0.5)).normalize();
  const ventralN = c.clone().addScaledVector(new Vector3().crossVectors(tan, vec(1, 0, 0)).normalize(), -n(1));
  const dorsalN = neckTop(i / idx("t2"));
  const hdT = topAt(i) + 0.005 - c.y;
  const hvT = c.y - prof(ventral, c.z);
  const centre = lerp(lerp(dorsalN, ventralN, 0.5), c.clone().add(vec(0, (hdT - hvT) / 2, 0)), w);
  const u = lerp(dorsalN.clone().sub(ventralN).normalize(), vec(0, 1, 0), w).normalize();
  const h = (dorsalN.distanceTo(ventralN) / 2) * (1 - w) + ((hdT + hvT) / 2) * w;
  return { c: centre, col: c, u, h, a: n(2) * (1 - w) + prof(width, c.z) * w, k: 0.18 * w };
}

// Point on the body surface: i along the column, th from 0 (dorsal midline)
// through pi/2 (lateral) to pi (ventral midline), `off` outward along the normal.
function body(i: number | string, th: number, off = 0): V {
  const ii = at(i);
  const raw = (ii2: number, th2: number) => {
    const s = section(ii2);
    const sn = Math.sin(th2);
    const cs = Math.cos(th2);
    const x = -s.a * Math.pow(Math.abs(sn), 0.75) * (1 + s.k * cs);
    const up = s.h * Math.sign(cs) * Math.pow(Math.abs(cs), 0.9);
    return s.c
      .clone()
      .add(vec(x, 0, 0))
      .addScaledVector(s.u, up);
  };
  const p = raw(ii, th);
  if (!off) return p;
  const di = raw(ii + 0.02, th).sub(raw(ii - 0.02, th));
  const dt = raw(ii, th + 0.01).sub(raw(ii, th - 0.01));
  const n = new Vector3().crossVectors(di, dt).normalize();
  if (n.dot(p.clone().sub(section(ii).c)) < 0) n.negate();
  return p.addScaledVector(n, off);
}

// Body coordinates (i, th) of the surface point nearest to p (left side).
function bodyCoords(p: V): [number, number] {
  const q = vec(-Math.abs(p.x), p.y, p.z);
  let best: [number, number] = [0, 0];
  let bestD = Infinity;
  const test = (i: number, th: number) => {
    if (i < 0 || i > idx("s3") || th < 0 || th > Math.PI) return;
    const d = body(i, th).distanceToSquared(q);
    if (d < bestD) {
      bestD = d;
      best = [i, th];
    }
  };
  for (let i = 0; i <= idx("s3"); i += 0.5) for (let th = 0; th <= Math.PI; th += Math.PI / 24) test(i, th);
  for (const step of [0.25, 0.1, 0.04, 0.015]) {
    const [i0, t0] = best;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) test(i0 + a * step, t0 + b * step * 0.5);
  }
  return best;
}
// Projects p onto the body surface, `off` outward.
const drape = (p: V, off = 0) => body(...bodyCoords(p), off);

// Angle reached when walking `arc` metres along the body surface from th0 (toward dorsal if sign < 0).
function arcTheta(i: number | string, th0: number, arc: number, sign = 1) {
  let th = th0;
  let len = 0;
  let prev = body(i, th);
  while (len < arc && th > 0 && th < Math.PI) {
    th += sign * 0.005;
    const p = body(i, th);
    len += p.distanceTo(prev);
    prev = p;
  }
  return th;
}

// ---------------------------------------------------------------- geometry

// `reach`: per vertex, how deep below it another muscle still counts as inside
// (slab outer faces: their thickness; inner faces are not obstacles).
type Mesh = { pos: V[]; tri: number[]; reach?: number[] };

// Closed slab over a grid of base points grid[u][v]; the outer face is pushed
// along the surface normal (oriented by `out`) by the thickness at (u, v).
function slab(grid: V[][], thick: (u: number, v: number) => number, out: (p: V) => V): Mesh {
  const nu = grid.length;
  const nv = grid[0].length;
  const pos: V[] = [];
  const normal = (u: number, v: number) => {
    const du = grid[Math.min(u + 1, nu - 1)][v].clone().sub(grid[Math.max(u - 1, 0)][v]);
    const dv = grid[u][Math.min(v + 1, nv - 1)].clone().sub(grid[u][Math.max(v - 1, 0)]);
    const n = new Vector3().crossVectors(du, dv);
    if (n.lengthSq() < 1e-14) n.copy(out(grid[u][v]));
    n.normalize();
    if (n.dot(out(grid[u][v])) < 0) n.negate();
    return n;
  };
  let sign = 0;
  const reach: number[] = [];
  for (let u = 0; u < nu; u++)
    for (let v = 0; v < nv; v++) {
      const n = normal(u, v);
      const t = Math.max(thick(u / (nu - 1), v / (nv - 1)), 0.0006);
      pos.push(grid[u][v].clone().addScaledVector(n, t));
      reach.push(t + 0.003);
      if (u < nu - 1 && v < nv - 1) {
        const du = grid[u + 1][v].clone().sub(grid[u][v]);
        const dv = grid[u][v + 1].clone().sub(grid[u][v]);
        sign += new Vector3().crossVectors(du, dv).dot(n);
      }
    }
  for (let u = 0; u < nu; u++)
    for (let v = 0; v < nv; v++) {
      pos.push(grid[u][v].clone());
      reach.push(-1);
    }
  const O = (u: number, v: number) => u * nv + v;
  const I = (u: number, v: number) => nu * nv + u * nv + v;
  const tri: number[] = [];
  for (let u = 0; u < nu - 1; u++)
    for (let v = 0; v < nv - 1; v++) {
      tri.push(O(u, v), O(u + 1, v), O(u + 1, v + 1), O(u, v), O(u + 1, v + 1), O(u, v + 1));
      tri.push(I(u, v), I(u + 1, v + 1), I(u + 1, v), I(u, v), I(u, v + 1), I(u + 1, v + 1));
    }
  const loop: [number, number][] = [];
  for (let u = 0; u < nu - 1; u++) loop.push([u, 0]);
  for (let v = 0; v < nv - 1; v++) loop.push([nu - 1, v]);
  for (let u = nu - 1; u > 0; u--) loop.push([u, nv - 1]);
  for (let v = nv - 1; v > 0; v--) loop.push([0, v]);
  for (let k = 0; k < loop.length; k++) {
    const [a, b] = [loop[k], loop[(k + 1) % loop.length]];
    tri.push(O(...a), I(...a), O(...b), O(...b), I(...a), I(...b));
  }
  if (sign < 0) for (let k = 0; k < tri.length; k += 3) [tri[k + 1], tri[k + 2]] = [tri[k + 2], tri[k + 1]];
  return { pos, tri, reach };
}

// Grid from fibres: every fibre is a list of control points (same count); each
// is splined along u, then the fibres are splined across v.
function fibreGrid(fibres: V[][], nu: number, nv: number): V[][] {
  const along = fibres.map((f) => spline(f, nu));
  return Array.from({ length: nu }, (_, u) =>
    spline(
      along.map((f) => f[u]),
      nv,
    ),
  );
}

type Edge = { u?: number; v?: number };
// Thickness taper toward the borders of a slab: t * (floor + (1 - floor) * ramp).
function taper(t: (u: number, v: number) => number, edge: Edge = {}, floor = 0.3) {
  const eu = edge.u ?? 0.12;
  const ev = edge.v ?? 0.12;
  return (u: number, v: number) => {
    const r = Math.min(eu ? smoothstep(0, eu, Math.min(u, 1 - u)) : 1, ev ? smoothstep(0, ev, Math.min(v, 1 - v)) : 1);
    return t(u, v) * (floor + (1 - floor) * Math.sqrt(r));
  };
}

type Tube = {
  pts: V[];
  w: Profile; // width (across the flat face) along s in [0, 1], metres
  t: Profile; // thickness (along `face`)
  face?: V | ((s: number) => V);
  n?: number;
  ring?: number;
  square?: number; // superellipse exponent factor, < 1 squarer
};

function tube({ pts, w, t, face = AXES.lat, n = 40, ring = 18, square = 1 }: Tube): Mesh {
  if (DEBUG) pts.forEach((p, k) => mark(`${building}.${k}`, p));
  const c = spline(pts, n);
  const pos: V[] = [];
  const tri: number[] = [];
  let lastN: V | undefined;
  for (let j = 0; j < n; j++) {
    const s = j / (n - 1);
    const tan = c[Math.min(j + 1, n - 1)]
      .clone()
      .sub(c[Math.max(j - 1, 0)])
      .normalize();
    const f = (typeof face === "function" ? face(s) : face).clone();
    let nn = f.addScaledVector(tan, -f.dot(tan));
    if (nn.lengthSq() < 1e-8) nn = lastN!.clone();
    nn.normalize();
    lastN = nn;
    const b = new Vector3().crossVectors(tan, nn);
    const hw = Math.max(prof(w, s), 0.0015) / 2;
    const ht = Math.max(prof(t, s), 0.0015) / 2;
    for (let k = 0; k < ring; k++) {
      const phi = (2 * Math.PI * k) / ring;
      const cs = Math.cos(phi);
      const sn = Math.sin(phi);
      const e = 2 / (2 + (1 - square) * 2);
      pos.push(
        c[j]
          .clone()
          .addScaledVector(b, hw * Math.sign(cs) * Math.pow(Math.abs(cs), e))
          .addScaledVector(nn, ht * Math.sign(sn) * Math.pow(Math.abs(sn), e)),
      );
    }
  }
  for (let j = 0; j < n - 1; j++)
    for (let k = 0; k < ring; k++) {
      const a = j * ring + k;
      const b = j * ring + ((k + 1) % ring);
      tri.push(a, a + ring, b, b, a + ring, b + ring);
    }
  const s0 = pos.length;
  pos.push(c[0].clone(), c[n - 1].clone());
  for (let k = 0; k < ring; k++) {
    tri.push(s0, k, (k + 1) % ring);
    tri.push(s0 + 1, (n - 1) * ring + ((k + 1) % ring), (n - 1) * ring + k);
  }
  // Orient outward.
  const mid = Math.floor(n / 2) * ring;
  const [a, b, d] = [pos[tri[mid * 6]], pos[tri[mid * 6 + 1]], pos[tri[mid * 6 + 2]]];
  const fn = new Vector3().crossVectors(b.clone().sub(a), d.clone().sub(a));
  if (fn.dot(a.clone().sub(c[Math.floor(n / 2)])) < 0) for (let k = 0; k < tri.length; k += 3) [tri[k + 1], tri[k + 2]] = [tri[k + 2], tri[k + 1]];
  return { pos, tri };
}

// ---------------------------------------------------------------- collisions

// Vertices with normals in a spatial hash, to push muscle vertices out of them.
class Obstacles {
  constructor(public cell = 0.008) {}
  map = new Map<string, number[]>();
  p: V[] = [];
  n: V[] = [];
  owner: string[] = [];
  reach: number[] = [];
  key(x: number, y: number, z: number) {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }
  add(name: string, pos: ArrayLike<number>, index: ArrayLike<number>, reach?: number[]) {
    const nrm = smoothNormals(pos, index);
    for (let i = 0; i < pos.length; i += 3) {
      if (reach && reach[i / 3] < 0) continue;
      const id = this.p.length;
      this.reach.push(reach ? reach[i / 3] : Infinity);
      this.p.push(vec(pos[i], pos[i + 1], pos[i + 2]));
      this.n.push(vec(nrm[i], nrm[i + 1], nrm[i + 2]));
      this.owner.push(name);
      const k = this.key(pos[i], pos[i + 1], pos[i + 2]);
      const list = this.map.get(k);
      if (list) list.push(id);
      else this.map.set(k, [id]);
    }
  }
  nearest(p: V, skip: (owner: string) => boolean) {
    let best = -1;
    let bestD = Infinity;
    const cx = Math.floor(p.x / this.cell);
    const cy = Math.floor(p.y / this.cell);
    const cz = Math.floor(p.z / this.cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = this.map.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!list) continue;
          for (const id of list) {
            const d = this.p[id].distanceToSquared(p);
            if (d < bestD && !skip(this.owner[id])) {
              bestD = d;
              best = id;
            }
          }
        }
    return best;
  }
  // Moves points that are inside (or closer than `clear` to) the obstacle surface.
  push(pts: V[], clear: number, skip: (owner: string) => boolean = () => false) {
    let moved = 0;
    for (const p of pts) {
      const id = this.nearest(p, skip);
      if (id < 0) continue;
      const d = p.clone().sub(this.p[id]).dot(this.n[id]);
      if (d < clear && d > -this.reach[id]) {
        p.addScaledVector(this.n[id], clear - d);
        moved++;
      }
    }
    return moved;
  }
}

function neighbours(m: Mesh) {
  const nb = m.pos.map(() => new Set<number>());
  for (let k = 0; k < m.tri.length; k += 3) {
    const [a, b, c] = [m.tri[k], m.tri[k + 1], m.tri[k + 2]];
    nb[a].add(b).add(c);
    nb[b].add(a).add(c);
    nb[c].add(a).add(b);
  }
  return nb.map((s) => [...s]);
}

// Taubin smoothing (no shrinkage).
function relax(m: Mesh, iterations: number) {
  const nb = neighbours(m);
  for (let it = 0; it < iterations; it++)
    for (const f of [0.5, -0.53]) {
      const next = m.pos.map((p, i) => {
        const avg = new Vector3();
        for (const j of nb[i]) avg.add(m.pos[j]);
        avg.divideScalar(nb[i].length || 1);
        return p.clone().lerp(avg, f);
      });
      m.pos.forEach((p, i) => p.copy(next[i]));
    }
}

const join = (...parts: Mesh[]): Mesh => {
  const out: Mesh = { pos: [], tri: [], reach: [] };
  for (const m of parts) {
    const off = out.pos.length;
    out.pos.push(...m.pos);
    out.tri.push(...m.tri.map((t) => t + off));
    out.reach!.push(...(m.reach ?? m.pos.map(() => Infinity)));
  }
  return out;
};

const toGeometry = (m: Mesh): Geometry => {
  const position = new Float32Array(m.pos.length * 3);
  m.pos.forEach((p, i) => p.toArray(position, i * 3));
  return { position, index: new Uint32Array(m.tri) };
};

const bones = new Obstacles();
// The clavicle floats inside the brachiocephalicus: not an obstacle.
for (const [name, g] of atlas) if (!isRight(name) && !name.includes("clavicle")) bones.add(name, g.position, g.index);
const muscles = new Obstacles();
// Skin (integumentary.glb, when present) with inward normals: muscle vertices
// up to 6 mm outside it are pulled 2 mm inside, as a last step. Larger
// protrusions mean the two models disagree and are left for a person to judge.
const SKIN = path.join(process.cwd(), "public", "models", "cat", "integumentary.glb");
const skin = await (async () => {
  if (!fs.existsSync(SKIN)) return undefined;
  const g = (await readScaled(SKIN)).get(meshKey("cat.integumentary.skin"));
  if (!g) return undefined;
  const inside = new Obstacles();
  inside.add("skin", g.position, g.index, Array.from({ length: g.position.length / 3 }, () => 0.006));
  for (const n of inside.n) n.negate();
  return inside;
})();

// ---------------------------------------------------------------- landmarks

const ortho = (d: V, axis: V) => d.clone().addScaledVector(axis, -d.dot(axis)).normalize();
const debugMarks: [string, V][] = [];
const mark = (name: string, p: V) => (debugMarks.push([name, p.clone()]), p);

// Scapula: t=0 dorsal border, t=1 glenoid; N lateral normal of the blade, Cr cranial in its plane.
const scapN = (() => {
  const n = pca(scapula.p).axes[2].clone();
  return n.x > 0 ? n.negate() : n;
})();
const scapCr = (() => {
  const c = new Vector3().crossVectors(scapula.ax, scapN).normalize();
  return c.z > 0 ? c.negate() : c;
})();
const spine = (t: number, off = 0) => scapula.surf(t, scapN, off);
const scapCranial = (t: number, off = 0) => scapula.surf(t, scapCr, off);
const scapCaudal = (t: number, off = 0) => scapula.surf(t, scapCr.clone().negate(), off);
const scapMedial = (t: number, w: number, off = 0) => {
  // Point on the medial face at level t, w from caudal (0) to cranial (1) border.
  const p = lerp(scapCaudal(t), scapCranial(t), w);
  return scapula
    .ext(scapN.clone().negate(), t - 0.04, t + 0.04)
    .sub(p)
    .projectOnVector(scapN)
    .add(p)
    .addScaledVector(scapN, -off);
};
const glenoid = scapula.b.clone();
const supraglenoid = scapula.ext(scapCr.clone().add(scapula.ax), 0.8, 1);
// Acromion: distal end of the spine, the most lateral point near the glenoid.
const acromion = scapula.ext(scapN.clone().add(scapula.ax.clone().multiplyScalar(0.3)), 0.6, 0.95);

const hCr = ortho(AXES.cra, humerus.ax);
const hLat = ortho(AXES.lat, humerus.ax);
const hUp = humerus.ax.clone().negate();
const hDir = (cr: number, lat: number, up = 0) => hCr.clone().multiplyScalar(cr).addScaledVector(hLat, lat).addScaledVector(hUp, up).normalize();
const greaterTubercle = humerus.ext(hDir(1, 0.3, 1), 0, 0.2);
const humeralHead = humerus.ext(hDir(-1, 0, 0.6), 0, 0.2);
const lesserTubercle = humerus.ext(hDir(0.3, -1, 0.5), 0, 0.2);
const deltoidTuberosity = humerus.surf(0.33, hDir(0.3, 1));
const teresTuberosity = humerus.surf(0.36, hDir(-0.2, -1));
const latEpicondyle = humerus.surf(0.9, hDir(0, 1));
const medEpicondyle = humerus.surf(0.9, hDir(0, -1));
const olecranon = ulna.ext({ dor: 1, cau: 0.4 });
const rCr = ortho(AXES.cra, radius.ax);
const rLat = ortho(AXES.lat, radius.ax);
const rDir = (cr: number, lat: number) => rCr.clone().multiplyScalar(cr).addScaledVector(rLat, lat).normalize();
const radialTuberosity = radius.surf(0.12, rDir(-0.3, -1));
const carpus = centroid(carpusP);
const mcProximal = metacarpus.at(0.1);
const mcDistal = metacarpus.at(0.95);
const digitsFore = centroid(phalangesThoracic);
// Dorsal surface of the forepaw, where the extensor tendons run.
const carpusDorsal = (med = 0) => argmax(carpusP, { cra: 1, med }).add(vec(0, 0, -0.002));
const mcDorsal = (t: number, med = 0) => metacarpus.surf(t, { cra: 1, dor: 0.3, med }, 0.002);
const toesDorsal = argmax(phalangesThoracic, { cra: 1, dor: 0.8 }).add(vec(0, 0.002, 0.006));
const accessoryCarpal = argmax(carpusP, { cau: 1, lat: 0.3 });

const tuberCoxae = coxae.ext({ cra: 1, ven: 0.6, lat: 0.4 });
const tuberSacrale = coxae.ext({ cra: 0.5, dor: 1, med: 0.4 });
const iliacCrest = coxae.ext({ cra: 1, dor: 0.3 });
const ischialTuber = coxae.ext({ cau: 1, lat: 0.5, dor: 0.2 });
const glutealSurface = coxae.surf(0.22, { lat: 1, dor: 0.4 });
const symphysis = coxae.ext({ med: 1, ven: 0.8 }, 0.45, 0.85);
const fLat = ortho(AXES.lat, femur.ax);
const fCr = ortho(AXES.cra, femur.ax);
const fDir = (cr: number, lat: number, up = 0) => fCr.clone().multiplyScalar(cr).addScaledVector(fLat, lat).addScaledVector(femur.ax, -up).normalize();
const greaterTrochanter = femur.ext(fDir(0, 0.6, 1), 0, 0.15);
const femoralHead = femur.ext(fDir(0, -1, 0.8), 0, 0.15);
const thirdTrochanter = femur.surf(0.2, fDir(-0.3, 1));
const lesserTrochanter = femur.surf(0.16, fDir(-0.6, -1));
const latSupracondylar = femur.surf(0.86, fDir(-1, 0.5));
const medSupracondylar = femur.surf(0.86, fDir(-1, -0.5));
const medCondyle = femur.surf(0.95, fDir(0, -1));
const patellaC = centroid(patella);
const tLat = ortho(AXES.lat, tibia.ax);
const tCr = ortho(AXES.cra, tibia.ax);
const tDir = (cr: number, lat: number) => tCr.clone().multiplyScalar(cr).addScaledVector(tLat, lat).normalize();
const tibialTuberosity = tibia.surf(0.08, tDir(1, 0));
const medTibia = (t: number, off = 0) => tibia.surf(t, tDir(0.3, -1), off);
const hock = tibia.b.clone();
const calcaneus = tarsus.ext({ cau: 1, dor: 0.5 });
const mtDorsal = (t: number, med = 0) => metatarsus.surf(t, { cra: 1, dor: 0.3, med }, 0.002);
const mtProximal = metatarsus.at(0.1);
const mtDistal = metatarsus.at(0.95);

// The head is carried low and flexed, so head landmarks use a head frame:
// rostral along the skull, dorsal perpendicular to it in the median plane.
const headR = skull.ax.clone().negate();
const headD = ortho(AXES.dor, headR).setX(0).normalize();
function hdir(d: Dir) {
  const out = new Vector3();
  const axes = { lat: AXES.lat, med: AXES.med, cra: headR, cau: headR.clone().negate(), dor: headD, ven: headD.clone().negate() };
  for (const [k, w] of Object.entries(d)) out.addScaledVector(axes[k as keyof typeof axes], w);
  return out.normalize();
}
const skullLeft = skull.p.filter((p) => p.x < 0);
const jawLeft = mandible.p;
const coronoid = argmax(
  jawLeft.filter((p) => mandible.t(p) > 0.6),
  hdir({ dor: 1, cau: 0.2 }),
);
const jawAngle = argmax(jawLeft, hdir({ cau: 1, ven: 0.7 }));
const mastoid = argmax(
  skullLeft.filter((p) => skull.t(p) > 0.8),
  hdir({ cau: 0.4, ven: 1, lat: 0.7 }),
);
const nuchalCrest = skull.ext(hdir({ cau: 1, dor: 0.8 }));
const zygomaticArch = (t: number) => skull.surf(t, { lat: 1 });
// Lateral wall of the braincase (medial to the zygomatic arch) at level t.
const braincase = (t: number, off = 0) => {
  const half = -zygomaticArch(t).x;
  const wall = skull.p.filter((p) => Math.abs(skull.t(p) - t) < 0.03 && p.x < 0 && p.x > -0.62 * half);
  return argmax(wall, hdir({ lat: 1, dor: 0.3 })).addScaledVector(hdir({ lat: 1, dor: 0.3 }), off);
};

for (const [n, p] of Object.entries({
  glenoid,
  supraglenoid,
  acromion,
  greaterTubercle,
  humeralHead,
  lesserTubercle,
  deltoidTuberosity,
  teresTuberosity,
  latEpicondyle,
  medEpicondyle,
  olecranon,
  radialTuberosity,
  carpus,
  mcProximal,
  mcDistal,
  digitsFore,
  accessoryCarpal,
  tuberCoxae,
  tuberSacrale,
  iliacCrest,
  ischialTuber,
  glutealSurface,
  symphysis,
  greaterTrochanter,
  femoralHead,
  thirdTrochanter,
  lesserTrochanter,
  latSupracondylar,
  medSupracondylar,
  medCondyle,
  patellaC,
  tibialTuberosity,
  hock,
  calcaneus,
  mtProximal,
  mtDistal,
  coronoid,
  jawAngle,
  mastoid,
  nuchalCrest,
}))
  mark(n, p);
for (const t of [0.05, 0.2, 0.4, 0.6, 0.8]) {
  mark(`spine${t}`, spine(t));
  mark(`scapCr${t}`, scapCranial(t));
  mark(`scapCd${t}`, scapCaudal(t));
}
for (const t of [0.35, 0.5, 0.65]) mark(`zyg${t}`, zygomaticArch(t));

// ---------------------------------------------------------------- build

type Part = {
  id: string; // mesh id (left side), e.g. dog.muscular.biceps-femoris.cranial
  make: () => Mesh;
  bones?: boolean; // push out of bones (default true)
  layer?: boolean; // push out of muscles built before (default true)
  ignore?: string[]; // mesh ids (prefixes) of built muscles not to push out of
  smooth?: number;
  single?: boolean; // midline structure: no mirrored copy
};
const parts: Part[] = [];
let building = "";
const muscle = (p: Part) => parts.push(p);

// ---------------------------------------------------------------- muscles

const M = "cat.muscular";
// Evenly spaced profile knots: P(a, b, c) -> [[0, a], [0.5, b], [1, c]].
const P = (...v: number[]): Profile => v.map((x, k) => [k / (v.length - 1), x]);
// Outward hint for slabs on the trunk and neck: away from the nearest point of the column.
const radial = (p: V) => {
  let best = stations[0].c;
  for (const s of stations) if (s.c.distanceToSquared(p) < best.distanceToSquared(p)) best = s.c;
  return p.clone().sub(best);
};
const away = (c: V) => (p: V) => p.clone().sub(c);
const fixed = (d: Dir) => () => dir(d);

// Tip of the left transverse process at a (fractional) cervical position;
// estimated on the body surface where the vertebra mesh is missing.
const transverse = (i: number) => {
  const tip = (k: number) => {
    return argmax(points(vertebraMesh(LABELS[k])!), { lat: 1, ven: 0.3 });
  };
  const k = Math.min(Math.floor(i), idx("c7") - 1);
  return lerp(tip(k), tip(k + 1), i - k);
};
// Lateral surface of rib k (fractional) at `frac` of its height from the
// ventral end; estimated on the body surface where the rib mesh is missing.
const ribPoint = (k: number, frac: number) => {
  const at = (n: number) => {
    const pts = points(required(`ribs.${n}`));
    const b = boxOf(pts);
    const y = b.min.y + (b.max.y - b.min.y) * frac;
    return argmax(
      pts.filter((p) => Math.abs(p.y - y) < 0.01),
      { lat: 1 },
    ).add(vec(-0.002, 0, 0));
  };
  const n = Math.min(Math.floor(k), 12);
  return lerp(at(n), at(n + 1), k - n);
};

// Slab on the body: u along the column from i0 to i1, v from th0(i) to th1(i);
// `off` lifts the base off the body surface.
function bodySlab(o: { i: [number, number]; th0: Profile; th1: Profile; thick: (u: number, v: number) => number; off?: number; nu?: number; nv?: number }) {
  const nu = o.nu ?? 40;
  const nv = o.nv ?? 16;
  const grid: V[][] = [];
  for (let a = 0; a < nu; a++) {
    const i = o.i[0] + ((o.i[1] - o.i[0]) * a) / (nu - 1);
    const t0 = prof(o.th0, i);
    const t1 = prof(o.th1, i);
    grid.push(Array.from({ length: nv }, (_, b) => body(i, t0 + ((t1 - t0) * b) / (nv - 1), o.off ?? 0)));
  }
  return slab(grid, o.thick, radial);
}

const I = idx;

// Trunk ------------------------------------------------------------------

// Cranial surface of the liver and caudal surface of the heart as z(x, y),
// when visceral.glb exists: the diaphragm dome is fitted between them.
const viscera = fs.existsSync(VISCERA) ? await readScaled(VISCERA) : undefined;
function zSurface(name: string, side: "front" | "back") {
  const g = viscera?.get(meshKey(name));
  if (!g) return undefined;
  const cell = 0.005;
  const sign = side === "front" ? 1 : -1;
  const map = new Map<string, number>();
  for (const p of points(g)) {
    const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
    map.set(k, Math.min(map.get(k) ?? Infinity, sign * p.z));
  }
  return (x: number, y: number) => {
    let z = Infinity;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) z = Math.min(z, map.get(`${Math.floor(x / cell) + a},${Math.floor(y / cell) + b}`) ?? Infinity);
    return sign * z;
  };
}
const liverFront = zSurface("cat.visceral.liver", "front");
const heartBack = zSurface("cat.visceral.heart", "back");

// Diaphragm: dome bulging cranially from the costal arch (xiphoid ventrally,
// last rib and L1 dorsally) to the cupula at about the 7th rib, or just
// cranial to the liver when the visceral model is present.
muscle({
  id: `${M}.diaphragm`,
  single: true,
  bones: false,
  make: () => {
    const nr = 14;
    const nphi = 48;
    const xiph = I("t10");
    const dors = I("l1");
    const ring = (phi: number) => {
      // phi 0 dorsal .. pi ventral on the left, mirrored for the right side.
      const th = Math.abs(phi);
      const i = dors + (xiph - dors) * (1 - Math.cos(th)) * 0.5;
      const s = section(i);
      const p = body(i, Math.max(th, 0.35), -0.02);
      if (th < 0.6) p.y = Math.min(p.y, s.col.y - 0.012);
      if (phi < 0) p.x = -p.x;
      return p;
    };
    const apex = column(I("t8"));
    apex.y = (topAt(I("t8")) + prof(ventral, apex.z)) / 2 - 0.02;
    apex.z = column(I("t7")).z;
    const dome = () =>
      Array.from({ length: nr }, (_, r) =>
        Array.from({ length: nphi }, (_, k) => {
          const b = ring(-Math.PI + (2 * Math.PI * k) / (nphi - 1));
          const a = ((r / (nr - 1)) * Math.PI) / 2;
          const p = lerp(vec(0, apex.y, b.z), b, Math.max(Math.cos(a), 0.02));
          p.z = b.z + (apex.z - b.z) * Math.sin(a);
          return { p };
        }),
      );
    // The abdominal face rests on the liver; the thoracic face (3 mm cranial)
    // stays caudal to the heart where the two organs leave room for it.
    const grid = dome().map((row) =>
      row.map(({ p }) => {
        const liver = liverFront ? liverFront(p.x, p.y) - 0.0015 : Infinity;
        const heart = heartBack ? heartBack(p.x, p.y) + 0.0045 : -Infinity;
        p.z = Math.min(p.z, liver);
        if (p.z < heart) p.z = heart <= liver ? heart : (heart + liver) / 2;
        return p;
      }),
    );
    return slab(grid, () => 0.003, fixed({ cra: 1 }));
  },
});

// Epaxial muscles (iliocostalis, longissimus, transversospinalis) as one mass
// dorsolateral to the vertebral column, from the ilium to the axis.
const epaxDepth: Profile = [
  [I("c2"), 0.024],
  [I("c4"), 0.04],
  [I("c6"), 0.034],
  [I("t1"), 0.018],
  [I("t10"), 0.016],
  [I("l3"), 0.024],
  [I("l7"), 0.022],
  [I("s2"), 0.012],
];
muscle({
  id: `${M}.epaxial`,
  bones: false,
  make: () => {
    const nu = 56;
    const nv = 14;
    const i0 = I("c2");
    const i1 = I("s2");
    const th1: Profile = [
      [I("c2"), 1.0],
      [I("c5"), 1.1],
      [I("t1"), 0.9],
      [I("t12"), 0.88],
      [I("l4"), 0.95],
      [I("s2"), 0.8],
    ];
    const grid: V[][] = [];
    for (let a = 0; a < nu; a++) {
      const i = i0 + ((i1 - i0) * a) / (nu - 1);
      const d = prof(epaxDepth, i);
      const t1 = prof(th1, i);
      // Deep face: moved toward the vertebral column (a normal offset would fold over the dorsal ridge).
      const col = section(i).col;
      grid.push(
        Array.from({ length: nv }, (_, b) => {
          const p = body(i, 0.05 + ((t1 - 0.05) * b) / (nv - 1));
          return p.lerp(col, Math.min(d / p.distanceTo(col), 0.8));
        }),
      );
    }
    return slab(
      grid,
      (u, v) => prof(epaxDepth, i0 + (i1 - i0) * u) * (1 - 0.6 * smoothstep(0.5, 1, v)) * (0.35 + 0.65 * smoothstep(0, 0.08, Math.min(u, 1 - u))) + 0.001,
      radial,
    );
  },
});

// Rectus abdominis: either side of the linea alba, from the first costal
// cartilage and sternum to the pecten of the pubis.
const rectusWidth: Profile = [
  [I("t1"), 0.012],
  [I("t6"), 0.022],
  [I("l1"), 0.036],
  [I("l5"), 0.032],
  [I("s3"), 0.012],
];
const rectusEdge = (i: number) => arcTheta(i, Math.PI - 0.02, prof(rectusWidth, i), -1);
muscle({
  id: `${M}.rectus-abdominis`,
  make: () => {
    const nu = 48;
    const nv = 8;
    const i0 = I("t1") + 0.3;
    const i1 = I("s3");
    const grid: V[][] = [];
    for (let a = 0; a < nu; a++) {
      const i = i0 + ((i1 - i0) * a) / (nu - 1);
      const t1 = rectusEdge(i);
      grid.push(Array.from({ length: nv }, (_, b) => body(i, Math.PI - 0.02 + ((t1 - Math.PI + 0.02) * b) / (nv - 1), 0.0005)));
    }
    const thick: Profile = [
      [0, 0.0015],
      [0.25, 0.002],
      [0.45, 0.0045],
      [0.85, 0.004],
      [1, 0.003],
    ];
    return slab(
      grid,
      taper((u) => prof(thick, u), { u: 0.04, v: 0.25 }, 0.4),
      radial,
    );
  },
});

// Serratus ventralis: fan from the transverse processes of C3-C7 and the
// first 7-8 ribs to the facies serrata on the medial scapula.
muscle({
  id: `${M}.serratus-ventralis`,
  make: () => {
    const nf = 16;
    const fibres: V[][] = [];
    for (let k = 0; k < nf; k++) {
      const v = k / (nf - 1);
      let origin: V;
      if (v < 0.4) {
        origin = transverse(I("c3") + (I("c7") - I("c3")) * (v / 0.4));
      } else {
        origin = ribPoint(1 + 7 * ((v - 0.4) / 0.6), 0.3);
      }
      const w = v < 0.4 ? 1 - 0.5 * (v / 0.4) : 0.45 * (1 - (v - 0.4) / 0.6);
      const ins = scapMedial(0.14, w, 0.002);
      const mid = drape(lerp(origin, ins, 0.5), 0.003);
      fibres.push([origin, mid, ins]);
    }
    const grid = fibreGrid(fibres, 18, 36).map((row) => row);
    // Grid is [u along fibre][v across]; slab expects the same.
    return slab(
      grid,
      taper((u, v) => (v < 0.4 ? 0.007 : 0.008) * (0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, u * 1.2))), { u: 0.05, v: 0.05 }, 0.5),
      radial,
    );
  },
});

// External abdominal oblique: costal digitations from ribs 4/5-13, lumbar part
// from the thoracolumbar fascia; fibres caudoventral; drawn up to the lateral
// border of the rectus (its aponeurosis continues to the linea alba).
muscle({
  id: `${M}.obliquus-externus-abdominis`,
  make: () =>
    bodySlab({
      i: [I("t5"), I("s3") - 0.3],
      th0: [
        [I("t5"), 1.75],
        [I("t9"), 1.45],
        [I("t13"), 1.2],
        [I("l3"), 1.1],
        [I("l6"), 1.15],
        [I("s1"), 1.9],
        [I("s3"), 2.7],
      ],
      th1: [
        [I("t5"), 1.8],
        [I("t7"), 2.2],
        [I("t10"), 2.6],
        [I("l1"), 2.75],
        [I("l6"), 2.8],
        [I("s3"), 2.75],
      ],
      off: 0.001,
      nu: 48,
      nv: 14,
      thick: taper((u, v) => 0.0045 - 0.0028 * smoothstep(0.55, 1, v), { u: 0.04, v: 0.08 }, 0.4),
    }),
});

// Thoracic limb ----------------------------------------------------------

// Supraspinatus and infraspinatus fill the fossae on either side of the spine.
function fossa(border: (t: number, off?: number) => V, end: V, depth: number, extra: number) {
  const ts = [0.03, 0.25, 0.5, 0.72];
  const pts = ts.map((t) => lerp(spine(t), border(t), 0.5).addScaledVector(scapN, depth * 0.35));
  const widths = ts.map((t) => spine(t).distanceTo(border(t)) + extra);
  return tube({
    pts: [...pts, end],
    w: [...ts.map((t, k) => [k / 4.6, widths[k]] as [number, number]), [0.88, 0.016], [1, 0.008]],
    t: P(depth * 0.6, depth, depth, depth * 0.8, 0.008),
    face: scapN,
    ring: 20,
  });
}
muscle({ id: `${M}.supraspinatus`, make: () => fossa(scapCranial, greaterTubercle.clone().addScaledVector(hCr, 0.002), 0.02, 0.012) });
muscle({ id: `${M}.infraspinatus`, make: () => fossa(scapCaudal, humerus.surf(0.08, hDir(0.2, 1), 0.002), 0.016, 0.004) });

muscle({
  id: `${M}.brachialis`,
  make: () =>
    tube({
      pts: [
        humerus.surf(0.14, hDir(-1, 0.5), 0.002),
        humerus.surf(0.4, hDir(-0.2, 1), 0.006),
        humerus.surf(0.72, hDir(0.7, 0.7), 0.007),
        humerus.surf(0.95, hDir(1, 0), 0.006),
        radius.surf(0.1, rDir(0.3, -1), 0.002),
      ],
      w: P(0.006, 0.016, 0.018, 0.012, 0.006),
      t: P(0.005, 0.011, 0.011, 0.008, 0.004),
    }),
});

muscle({
  id: `${M}.biceps-brachii`,
  make: () =>
    tube({
      pts: [
        supraglenoid,
        humerus.surf(0.04, hDir(1, -0.3), 0.004),
        humerus.surf(0.4, hDir(1, -0.5), 0.009),
        humerus.surf(0.85, hDir(0.6, -1), 0.007),
        radialTuberosity.clone().addScaledVector(rDir(0, -1), 0.002),
      ],
      w: P(0.004, 0.008, 0.016, 0.014, 0.005),
      t: P(0.004, 0.007, 0.014, 0.011, 0.004),
      face: AXES.med,
    }),
});

const olecranonTop = olecranon.clone().add(vec(0, 0.002, 0.002));
muscle({
  id: `${M}.triceps-brachii.medial`,
  make: () =>
    tube({
      pts: [humerus.surf(0.3, hDir(-0.3, -1), 0.003), humerus.surf(0.62, hDir(-0.7, -1), 0.008), olecranonTop.clone().add(vec(0.006, -0.004, 0))],
      w: P(0.008, 0.018, 0.008),
      t: P(0.006, 0.012, 0.005),
      face: AXES.med,
    }),
});
// Long head: broad origin on the caudal border of the scapula, filling the
// angle between scapula and humerus down to the olecranon.
muscle({
  id: `${M}.triceps-brachii.long`,
  make: () => {
    const nf = 9;
    const fibres: V[][] = [];
    for (let k = 0; k < nf; k++) {
      const v = k / (nf - 1);
      const o = scapCaudal(0.92 - 0.5 * v, 0.002).add(vec(0.012, 0, 0));
      const m = humerus.surf(0.5, hDir(-1, 0), 0.006 + 0.032 * v).add(vec(0.012, 0, 0));
      const e = olecranonTop.clone().add(vec(0.01, 0, 0.003 * v));
      fibres.push([o, m, e]);
    }
    return slab(
      fibreGrid(fibres, 24, 12),
      (u, v) => (0.006 + 0.022 * Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.7) * (0.55 + 0.45 * Math.sin(Math.PI * v)),
      fixed({ lat: 1 }),
    );
  },
});
muscle({
  id: `${M}.triceps-brachii.lateral`,
  make: () =>
    tube({
      pts: [
        humerus.surf(0.16, hDir(-0.6, 1), 0.003),
        humerus.surf(0.45, hDir(-0.5, 1), 0.012),
        humerus.surf(0.75, hDir(-1, 0.8), 0.014),
        olecranonTop.clone().add(vec(-0.006, -0.004, 0)),
      ],
      w: P(0.01, 0.028, 0.022, 0.008),
      t: P(0.004, 0.012, 0.011, 0.005),
      face: AXES.lat,
    }),
});

muscle({
  id: `${M}.extensor-carpi-radialis`,
  make: () =>
    tube({
      pts: [
        humerus.surf(0.76, hDir(0.2, 1), 0.003),
        humerus.surf(0.97, hDir(1, 0.6), 0.008),
        radius.surf(0.28, rDir(1, 0.1), 0.009),
        radius.surf(0.62, rDir(1, 0), 0.005),
        radius.surf(0.97, rDir(1, -0.2), 0.003),
        carpusDorsal(0.4),
        mcDorsal(0.12, 0.5),
      ],
      w: [
        [0, 0.01],
        [0.25, 0.02],
        [0.45, 0.016],
        [0.62, 0.006],
        [1, 0.004],
      ],
      t: [
        [0, 0.008],
        [0.25, 0.015],
        [0.45, 0.01],
        [0.62, 0.003],
        [1, 0.0025],
      ],
      face: rDir(1, 0),
    }),
});
muscle({
  id: `${M}.extensor-digitorum-communis`,
  make: () =>
    tube({
      pts: [
        latEpicondyle.clone().addScaledVector(hCr, 0.004),
        radius.surf(0.3, rDir(0.6, 1), 0.007),
        radius.surf(0.68, rDir(0.8, 0.6), 0.004),
        radius.surf(0.97, rDir(1, 0.3), 0.003),
        carpusDorsal(),
        mcDorsal(0.5),
        mcDorsal(0.95),
        toesDorsal,
      ],
      w: [
        [0, 0.008],
        [0.2, 0.016],
        [0.42, 0.012],
        [0.55, 0.006],
        [1, 0.006],
      ],
      t: [
        [0, 0.006],
        [0.2, 0.011],
        [0.42, 0.007],
        [0.55, 0.0025],
        [1, 0.0025],
      ],
      face: rDir(0.5, 1),
    }),
});
muscle({
  id: `${M}.flexor-carpi-ulnaris`,
  make: () =>
    tube({
      pts: [
        lerp(medEpicondyle, olecranon, 0.55).addScaledVector(rDir(0, -1), 0.004),
        ulna.surf(0.35, { cau: 1, med: 0.4 }, 0.008),
        ulna.surf(0.7, { cau: 1, med: 0.2 }, 0.006),
        accessoryCarpal.clone().add(vec(0, 0.004, 0.002)),
      ],
      w: P(0.012, 0.016, 0.01, 0.005),
      t: P(0.008, 0.011, 0.007, 0.004),
      face: AXES.cau,
    }),
});

muscle({
  id: `${M}.deltoideus.scapular`,
  make: () => {
    const nf = 9;
    const fibres: V[][] = [];
    for (let k = 0; k < nf; k++) {
      const v = k / (nf - 1);
      // Aponeurotic origin along the spine; the belly fans over the infraspinatus.
      const o = spine(0.62 - 0.5 * v, 0.003);
      const mid = lerp(spine(0.5), scapCaudal(0.5), 0.1 + 0.75 * v).addScaledVector(scapN, 0.022);
      const ins = deltoidTuberosity.clone().addScaledVector(humerus.ax, (v - 0.5) * 0.008).addScaledVector(hLat, 0.003);
      fibres.push([o, mid, ins]);
    }
    return slab(fibreGrid(fibres, 20, 12), taper((u) => 0.002 + 0.006 * Math.sin(Math.PI * u), { u: 0, v: 0.15 }), away(scapula.at(0.5).addScaledVector(scapN, -0.05)));
  },
});
muscle({
  id: `${M}.deltoideus.acromial`,
  make: () =>
    tube({
      pts: [acromion.clone().addScaledVector(scapN, 0.002), humerus.surf(0.15, hDir(0.2, 1), 0.012), deltoidTuberosity.clone().addScaledVector(hLat, 0.003)],
      w: P(0.01, 0.018, 0.008),
      t: P(0.006, 0.011, 0.005),
    }),
});

// Pectorals: deep (ascending) from the sternum to the tubercles of the
// humerus; superficial (descending and transverse) from the manubrium and
// first sternebrae to the crest of the greater tubercle and the forearm fascia.
muscle({
  id: `${M}.pectorales.profundus`,
  make: () => {
    const nf = 12;
    const fibres: V[][] = [];
    for (let k = 0; k < nf; k++) {
      const v = k / (nf - 1);
      const i = I("t2") + (I("t11") - I("t2")) * v;
      const o = body(i, Math.PI - 0.04, 0.003);
      const side = body(I("t2") + (i - I("t2")) * 0.35, 2.45 - 0.2 * v, 0.004);
      const arm = humerus.surf(0.3 - 0.1 * v, hDir(0.2, -1), 0.006);
      const ins = lerp(greaterTubercle.clone().addScaledVector(hCr, 0.004), lesserTubercle.clone().addScaledVector(hLat, -0.003), 0.3 + 0.7 * v);
      fibres.push([o, side, arm, ins]);
    }
    return slab(fibreGrid(fibres, 24, 14), taper((u) => 0.004 + 0.006 * smoothstep(0, 0.6, u) - 0.004 * smoothstep(0.85, 1, u), { u: 0.02, v: 0.1 }), (p) => radial(p).add(vec(0, -0.5, 0)));
  },
});
muscle({
  id: `${M}.pectorales.superficiales`,
  make: () => {
    const nf = 9;
    const fibres: V[][] = [];
    for (let k = 0; k < nf; k++) {
      const v = k / (nf - 1);
      const o = body(I("t1") + 0.4 + 2.2 * v, Math.PI - 0.04, 0.004);
      const ins = v < 0.75 ? humerus.surf(0.15 + 0.7 * (v / 0.75), hDir(1, -0.4), 0.004) : radius.surf(0.05 + 0.25 * ((v - 0.75) / 0.25), rDir(0.2, -1), 0.004);
      const mid = lerp(o, ins, 0.5).add(vec(0, -0.008, -0.004));
      fibres.push([o, mid, ins]);
    }
    return slab(fibreGrid(fibres, 18, 12), taper((u) => 0.003 + 0.003 * Math.sin(Math.PI * u), { u: 0.02, v: 0.1 }), (p) => radial(p).add(vec(0, -0.3, -0.5)));
  },
});

// Latissimus dorsi: from the thoracolumbar fascia (spinous processes of the
// caudal thoracic and lumbar vertebrae) and last ribs, converging
// cranioventrally behind the triceps to the teres major tuberosity.
muscle({
  id: `${M}.latissimus-dorsi`,
  // Passes medial to the long head of the triceps to reach the humerus.
  ignore: [`${M}.triceps-brachii`],
  make: () => {
    const nf = 14;
    const fibres: V[][] = [];
    const ax = I("t4");
    for (let k = 0; k < nf; k++) {
      const v = k / (nf - 1);
      const io = I("t6") + (I("l4") - I("t6")) * v;
      const o = body(io, 0.12, 0.003);
      const a = body(io + (ax - io) * 0.35, 0.95 + 0.25 * v, 0.004);
      const b = body(io + (ax - io) * 0.72, 1.35 + 0.15 * v, 0.005);
      const x = body(ax + 0.8 * v, 1.7 + 0.05 * v, 0.006);
      const ins = teresTuberosity.clone().addScaledVector(humerus.ax, (v - 0.5) * 0.01).addScaledVector(hLat, -0.003);
      fibres.push([o, a, b, x, ins]);
    }
    return slab(
      fibreGrid(fibres, 30, 16),
      taper((u) => 0.0015 + 0.004 * smoothstep(0.2, 0.45, u) + 0.002 * smoothstep(0.6, 0.85, u), { u: 0.02, v: 0.06 }),
      radial,
    );
  },
});

// Trapezius: cervical part from the median raphe of the neck, thoracic part
// from the supraspinous ligament, both to the spine of the scapula.
muscle({
  id: `${M}.trapezius`,
  make: () => {
    const nf = 16;
    const fibres: V[][] = [];
    for (let k = 0; k < nf; k++) {
      const v = k / (nf - 1);
      const o = body(I("c3") + (I("t9") - I("c3")) * v, 0.02, 0.003);
      const t = prof(
        [
          [0, 0.6],
          [0.45, 0.04],
          [1, 0.2],
        ],
        v,
      );
      const ins = spine(t, 0.002);
      const mid = drape(lerp(o, ins, 0.5), 0.014);
      fibres.push([o, mid, ins]);
    }
    return slab(fibreGrid(fibres, 16, 24), taper(() => 0.0025, { u: 0.04, v: 0.04 }), radial);
  },
});

// Omotransversarius: acromion and distal spine of the scapula to the wing of the atlas.
const atlasWing = (() => {
  const g = skel("atlas")!;
  return argmax(points(g), { lat: 1, cau: 0.3 });
})();
muscle({
  id: `${M}.omotransversarius`,
  make: () =>
    tube({
      pts: [spine(0.78, 0.003), body(I("c6"), 1.45, 0.01), body(I("c4"), 1.35, 0.008), atlasWing.clone().add(vec(-0.002, 0, 0))],
      w: P(0.024, 0.02, 0.016, 0.01),
      t: P(0.003, 0.005, 0.005, 0.004),
      face: (s) => (s < 0.15 ? scapN : AXES.lat),
    }),
});

// Brachiocephalicus: the cat keeps a vestigial clavicle inside it, the
// boundary between the cleidobrachialis (to the distal humerus and ulna) and
// the cleidocephalicus (cleidocervicalis to the dorsal raphe of the neck,
// cleidomastoideus to the mastoid process).
const clavicle = points(required("clavicle"));
const clavicular = lerp(centroid(clavicle), argmax(clavicle, { lat: 1 }), 0.4);
muscle({
  id: `${M}.brachiocephalicus.cleidobrachialis`,
  make: () =>
    tube({
      pts: [clavicular, humerus.surf(0.35, hDir(1, 0.2), 0.012), humerus.surf(0.7, hDir(1, -0.3), 0.008), humerus.surf(0.88, hDir(0.6, -1), 0.004)],
      w: P(0.024, 0.02, 0.012, 0.006),
      t: P(0.008, 0.008, 0.006, 0.003),
      face: hCr,
    }),
});
muscle({
  id: `${M}.brachiocephalicus.cleidocephalicus`,
  make: () => {
    const nf = 10;
    const fibres: V[][] = [];
    for (let k = 0; k < nf; k++) {
      const v = k / (nf - 1);
      const o = clavicular.clone().addScaledVector(hUp, (v - 0.5) * 0.02);
      const a = body(I("c6"), 2.0 - 0.6 * v, 0.008);
      const b = body(I("c4"), 1.9 - 1.3 * v, 0.008);
      const end = v < 0.25 ? mastoid.clone().add(vec(-0.004, 0, 0)) : body(I("c2") + 0.6 * (1 - v), 0.04 + 1.0 * (1 - v), 0.004);
      fibres.push([o, a, b, end]);
    }
    return slab(fibreGrid(fibres, 22, 14), taper(() => 0.004, { u: 0.03, v: 0.08 }), radial);
  },
});

// Pelvic limb -----------------------------------------------------------

const sacral = (i: number) => {
  // Lateral border of the sacrum; beyond S3 extrapolated along the first caudal vertebrae.
  const k = Math.min(i, I("s3"));
  const p = column(k).add(column(I("s3")).sub(column(I("s2"))).multiplyScalar(Math.max(0, i - I("s3"))));
  p.x = -0.016;
  p.y = topAt(k) - 0.008 - Math.max(0, i - I("s3")) * 0.006;
  return p;
};
const digitsHind = centroid(points(required("phalanges-pelvic")));
const fd = (cr: number, lat: number) => fDir(cr, lat);
// Point in the thigh at level t of the femur, `cr` metres cranial (negative: caudal) and `lat` lateral of its axis.
const thigh = (t: number, cr: number, lat: number) => femur.at(t).addScaledVector(fCr, cr).addScaledVector(fLat, lat);

muscle({
  id: `${M}.gluteus-medius`,
  make: () =>
    tube({
      pts: [
        iliacCrest.clone().add(vec(-0.004, 0, 0.006)),
        coxae.surf(0.2, { lat: 1, dor: 0.25 }, 0.007),
        coxae.surf(0.4, { lat: 1, dor: 0.3 }, 0.01),
        greaterTrochanter.clone().add(vec(0, 0.004, 0.002)),
      ],
      w: P(0.026, 0.04, 0.034, 0.014),
      t: P(0.008, 0.016, 0.016, 0.008),
      face: dir({ lat: 1, dor: 0.4 }),
    }),
});

const quad = (pts: V[], w: Profile, t: Profile, face: V) => tube({ pts, w, t, face });
muscle({
  id: `${M}.quadriceps-femoris.vastus-medialis`,
  make: () =>
    quad(
      [femur.surf(0.14, fd(0.3, -1), 0.003), femur.surf(0.5, fd(0.6, -1), 0.01), femur.surf(0.85, fd(0.9, -0.6), 0.008), patellaC.clone().add(vec(0.008, 0.01, 0))],
      P(0.016, 0.03, 0.026, 0.012),
      P(0.008, 0.018, 0.016, 0.006),
      fd(0, -1),
    ),
});
muscle({
  id: `${M}.quadriceps-femoris.vastus-lateralis`,
  make: () =>
    quad(
      [femur.surf(0.1, fd(0.3, 1), 0.003), femur.surf(0.45, fd(0.6, 1), 0.012), femur.surf(0.82, fd(1, 0.6), 0.008), patellaC.clone().add(vec(-0.006, 0.012, 0))],
      P(0.02, 0.036, 0.028, 0.012),
      P(0.01, 0.02, 0.016, 0.006),
      fd(0, 1),
    ),
});
muscle({
  id: `${M}.quadriceps-femoris.rectus-femoris`,
  make: () =>
    quad(
      [
        lerp(femoralHead, tuberCoxae, 0.3).add(vec(-0.004, -0.004, 0)),
        femur.surf(0.2, fd(1, 0.1), 0.016),
        femur.surf(0.55, fd(1, 0.1), 0.02),
        patellaC.clone().add(vec(0, 0.014, -0.004)),
      ],
      P(0.01, 0.024, 0.026, 0.012),
      P(0.007, 0.02, 0.02, 0.007),
      fd(1, 0),
    ),
});

muscle({
  id: `${M}.semimembranosus`,
  make: () =>
    tube({
      pts: [
        ischialTuber.clone().add(vec(0.006, -0.006, 0)),
        thigh(0.45, -0.045, -0.018),
        thigh(0.82, -0.03, -0.02),
        medCondyle.clone().addScaledVector(fd(-1, 0), 0.004),
        medTibia(0.06, 0.002),
      ],
      w: P(0.02, 0.036, 0.03, 0.016, 0.006),
      t: P(0.014, 0.028, 0.024, 0.012, 0.005),
      face: AXES.med,
    }),
});

muscle({
  id: `${M}.gastrocnemius.lateral`,
  make: () =>
    tube({
      pts: [
        latSupracondylar.clone().addScaledVector(fd(-1, 0), 0.003),
        tibia.surf(0.25, tDir(-1, 0.5), 0.026),
        tibia.surf(0.55, tDir(-1, 0.2), 0.014),
        tibia.surf(0.85, tDir(-1, 0), 0.01),
        calcaneus.clone().add(vec(0, 0.004, 0)),
      ],
      w: P(0.014, 0.026, 0.016, 0.008, 0.006),
      t: P(0.012, 0.022, 0.012, 0.005, 0.005),
      face: tLat,
    }),
});
muscle({
  id: `${M}.gastrocnemius.medial`,
  make: () =>
    tube({
      pts: [
        medSupracondylar.clone().addScaledVector(fd(-1, 0), 0.003),
        tibia.surf(0.25, tDir(-1, -0.5), 0.026),
        tibia.surf(0.55, tDir(-1, -0.2), 0.014),
        tibia.surf(0.85, tDir(-1, 0), 0.01),
        calcaneus.clone().add(vec(0.002, 0.004, 0)),
      ],
      w: P(0.014, 0.026, 0.016, 0.008, 0.006),
      t: P(0.012, 0.022, 0.012, 0.005, 0.005),
      face: tLat,
    }),
});
// Its tendon twists around the gastrocnemius tendon and caps the calcaneal tuber.
muscle({
  id: `${M}.flexor-digitorum-superficialis-pelvic`,
  ignore: [`${M}.gastrocnemius`],
  make: () =>
    tube({
      pts: [
        lerp(latSupracondylar, medSupracondylar, 0.35).addScaledVector(fd(-1, 0), 0.006),
        tibia.surf(0.3, tDir(-1, 0), 0.03),
        tibia.surf(0.7, tDir(-1, 0), 0.02),
        calcaneus.clone().add(vec(0, 0.005, 0.002)),
        metatarsus.surf(0.4, { cau: 1 }, 0.005),
        mtDistal.clone().add(vec(0, 0, 0.006)),
        digitsHind.clone().add(vec(0, -0.002, -0.004)),
      ],
      w: [
        [0, 0.008],
        [0.15, 0.014],
        [0.3, 0.008],
        [0.45, 0.006],
        [1, 0.005],
      ],
      t: [
        [0, 0.008],
        [0.15, 0.012],
        [0.3, 0.005],
        [0.45, 0.003],
        [1, 0.003],
      ],
      face: tLat,
    }),
});
muscle({
  id: `${M}.tibialis-cranialis`,
  make: () =>
    tube({
      pts: [
        tibia.surf(0.06, tDir(0.6, 1), 0.003),
        tibia.surf(0.3, tDir(1, 0.6), 0.012),
        tibia.surf(0.7, tDir(1, 0.3), 0.006),
        tibia.surf(0.97, tDir(1, -0.4), 0.004),
        mtDorsal(0.08, 0.6),
      ],
      w: P(0.01, 0.018, 0.012, 0.005, 0.004),
      t: P(0.008, 0.015, 0.008, 0.004, 0.003),
      face: tLat,
    }),
});

// Sartorius: in the cat one broad sheet (the dog's two parts) from the iliac
// crest and the cranial ventral iliac spine over the cranial border and the
// cranial half of the medial thigh, to the patella and the medial tibia.
muscle({
  id: `${M}.sartorius`,
  make: () => {
    const nf = 9;
    const fibres: V[][] = [];
    for (let k = 0; k < nf; k++) {
      const v = k / (nf - 1);
      const o = lerp(iliacCrest.clone().add(vec(0, -0.004, -0.004)), tuberCoxae.clone().add(vec(0, -0.006, 0.004)), v);
      const a = lerp(tuberCoxae, femur.surf(0.25, fd(1 - 0.6 * v, -0.2 - 0.8 * v), 0.03), 0.6);
      const b = femur.surf(0.55, fd(1 - 0.9 * v, -0.3 - 0.7 * v), 0.028);
      const c = femur.surf(0.85, fd(0.8 - 0.8 * v, -0.6 - 0.4 * v), 0.018);
      const e = lerp(patellaC.clone().add(vec(0.008, 0.004, 0)), medTibia(0.15, 0.004), v);
      fibres.push([o, a, b, c, e]);
    }
    return slab(fibreGrid(fibres, 24, 14), taper((u) => 0.003 + 0.0035 * Math.sin(Math.PI * u), { u: 0.03, v: 0.1 }), (p) => p.clone().sub(femur.at(0.5)));
  },
});

muscle({
  id: `${M}.gracilis`,
  make: () => {
    const nf = 8;
    const fibres: V[][] = [];
    for (let k = 0; k < nf; k++) {
      const v = k / (nf - 1);
      const o = symphysis.clone().add(vec(-0.004, -0.004, -0.012 + 0.05 * v));
      const m = femur.surf(0.5, fd(-0.3 - 0.6 * v, -1), 0.032 + 0.012 * v);
      const e = medTibia(0.18 + 0.12 * v, 0.006);
      fibres.push([o, m, e]);
    }
    return slab(fibreGrid(fibres, 22, 10), taper((u) => 0.003 + 0.003 * Math.sin(Math.PI * u), { u: 0.03, v: 0.1 }), fixed({ med: 1 }));
  },
});

muscle({
  id: `${M}.semitendinosus`,
  make: () =>
    tube({
      pts: [
        ischialTuber.clone().add(vec(-0.002, -0.006, 0.004)),
        thigh(0.45, -0.058, 0.0),
        thigh(0.82, -0.042, -0.012),
        tibia.surf(0.15, tDir(-0.4, -1), 0.012),
        medTibia(0.3, 0.003),
      ],
      w: P(0.016, 0.03, 0.026, 0.012, 0.006),
      t: P(0.014, 0.024, 0.02, 0.009, 0.004),
      face: AXES.lat,
    }),
});

muscle({
  id: `${M}.gluteus-superficialis`,
  make: () => {
    const nf = 8;
    const fibres: V[][] = [];
    for (let k = 0; k < nf; k++) {
      const v = k / (nf - 1);
      const o = sacral(I("s1") + 0.5 + 2.6 * v);
      const e = thirdTrochanter.clone().addScaledVector(femur.ax, (v - 0.5) * 0.008).addScaledVector(fLat, 0.003);
      const m = lerp(o, e, 0.5).addScaledVector(fLat, 0.016);
      fibres.push([o, m, e]);
    }
    return slab(fibreGrid(fibres, 16, 10), taper((u) => 0.003 + 0.005 * Math.sin(Math.PI * u), { u: 0, v: 0.12 }), fixed({ lat: 1, dor: 0.3 }));
  },
});

muscle({
  id: `${M}.tensor-fasciae-latae`,
  make: () => {
    const nf = 8;
    const fibres: V[][] = [];
    for (let k = 0; k < nf; k++) {
      const v = k / (nf - 1);
      const o = tuberCoxae.clone().add(vec(-0.003, -0.004 * v, 0.022 * v));
      const e = femur.surf(0.42, fd(1 - 1.1 * v, 0.8), 0.024 + 0.006 * v);
      const m = lerp(o, e, 0.5).addScaledVector(fLat, 0.012);
      fibres.push([o, m, e]);
    }
    return slab(fibreGrid(fibres, 16, 10), taper((u) => 0.002 + 0.004 * Math.sin(Math.PI * Math.min(1, u * 1.4)), { u: 0.03, v: 0.1 }), fixed({ lat: 1 }));
  },
});

// Biceps femoris: one fan from the ischiatic tuberosity (the cat has no
// sacrotuberous ligament) to the patella, patellar ligament, tibial crest and crural
// fascia; drawn as its cranial and caudal parts. The caudal part continues as
// a tarsal tendon to the calcaneal tuber.
function bicepsFibre(v: number) {
  const o = ischialTuber.clone().add(vec(-0.006, 0.012 * (1 - v), -0.014 * (1 - v)));
  const ins =
    v < 0.3
      ? lerp(patellaC.clone().add(vec(-0.01, 0.008, 0)), lerp(patellaC, tibialTuberosity, 0.7).add(vec(-0.008, 0, 0)), v / 0.3)
      : v < 0.65
        ? tibia.surf(0.08 + 0.3 * ((v - 0.3) / 0.35), tDir(0.6, 1), 0.006)
        : tibia.surf(0.38 + 0.12 * ((v - 0.65) / 0.35), tDir(-0.4 - 0.6 * ((v - 0.65) / 0.35), 1), 0.008);
  const mid = thigh(0.5, 0.012 - 0.06 * v, 0.024 + 0.004 * Math.sin(Math.PI * v));
  const knee = thigh(0.88, 0.012 - 0.045 * v, 0.02);
  return [o, mid, knee, ins];
}
const bicepsPart = (v0: number, v1: number, nv: number) => {
  const fibres = Array.from({ length: nv }, (_, k) => bicepsFibre(v0 + ((v1 - v0) * k) / (nv - 1)));
  return slab(
    fibreGrid(fibres, 26, nv * 2),
    taper((u) => 0.004 + 0.008 * Math.sin(Math.PI * Math.min(1, u * 1.15)), { u: 0.03, v: 0.1 }, 0.5),
    fixed({ lat: 1 }),
  );
};
muscle({ id: `${M}.biceps-femoris.cranial`, make: () => bicepsPart(0, 0.6, 7) });
muscle({
  id: `${M}.biceps-femoris.caudal`,
  make: () =>
    join(
      bicepsPart(0.6, 1, 5),
      tube({
        pts: [tibia.surf(0.42, tDir(-1, 0.8), 0.01), tibia.surf(0.7, tDir(-1, 0.4), 0.014), calcaneus.clone().add(vec(-0.002, 0.004, 0))],
        w: P(0.006, 0.004, 0.003),
        t: P(0.002, 0.002, 0.002),
        ring: 8,
      }),
    ),
});

// Head and neck ----------------------------------------------------------

// Temporalis: large in the cat, filling the temporal fossa from the
// temporal lines and the lateral wall of the braincase to the coronoid
// process, medial to the zygomatic arch.
muscle({
  id: `${M}.temporalis`,
  smooth: 4,
  make: () => {
    const nf = 10;
    const fibres: V[][] = [];
    for (let k = 0; k < nf; k++) {
      const v = k / (nf - 1);
      const o = skull.surf(0.56 + 0.4 * v, hdir({ dor: 1, lat: 0.4 + 0.3 * v }), 0.004);
      const m = braincase(0.6 + 0.3 * v, 0.01);
      const e = coronoid.clone().addScaledVector(skull.ax, (v - 0.5) * 0.008);
      fibres.push([o, m, e]);
    }
    return slab(fibreGrid(fibres, 16, 14), taper((u) => 0.004 + 0.012 * Math.sin(Math.PI * Math.min(1, u * 1.1)), { u: 0.03, v: 0.1 }), away(skull.at(0.75)));
  },
});
// Masseter: ventral border of the zygomatic arch to the masseteric fossa and
// the angle of the mandible.
muscle({
  id: `${M}.masseter`,
  make: () => {
    const nf = 8;
    const fibres: V[][] = [];
    for (let k = 0; k < nf; k++) {
      const v = k / (nf - 1);
      const o = zygomaticArch(0.32 + 0.3 * v).addScaledVector(headD, -0.004);
      const e = mandible.surf(0.66 + 0.26 * v, hdir({ lat: 1, ven: 0.8 }), 0.002);
      const m = lerp(o, e, 0.5).add(vec(-0.005, 0, 0));
      fibres.push([o, m, e]);
    }
    return slab(fibreGrid(fibres, 14, 12), taper((u) => 0.004 + 0.007 * Math.sin(Math.PI * u), { u: 0.02, v: 0.1 }), fixed({ lat: 1 }));
  },
});

muscle({
  id: `${M}.sternocephalicus`,
  make: () =>
    tube({
      pts: [
        argmax(manubrium, { cra: 1 }).add(vec(-0.006, 0, 0)),
        body(I("c6"), 2.55, 0.006),
        body(I("c4"), 2.25, 0.008),
        body(I("c2"), 1.95, 0.006),
        mastoid.clone().add(vec(-0.004, 0, 0)),
      ],
      w: P(0.012, 0.018, 0.018, 0.016, 0.01),
      t: P(0.006, 0.008, 0.008, 0.007, 0.005),
      face: dir({ lat: 1, cra: 0.8 }),
    }),
});

// --debug: also draw the body surface and the landmarks, and write to .cache/agent-out instead.
if (DEBUG) {
  const grid: V[][] = [];
  for (let i = 0; i <= idx("s3"); i += 0.25) {
    const row: V[] = [];
    for (let th = 0; th <= Math.PI + 1e-6; th += Math.PI / 24) row.push(body(i, th));
    grid.push(row);
  }
  muscle({ id: "debug.body", make: () => slab(grid, () => 0.001, (p) => p.clone().sub(vec(0, p.y, p.z))), bones: false, layer: false, single: true });
}

const model = createModel("cat.muscular", [0.69, 0.41, 0.36, 1]);
let total = 0;
for (const part of parts) {
  building = part.id;
  const m = part.make();
  const skip = (owner: string) => (part.ignore ?? []).some((x) => owner.startsWith(x));
  const layer = part.layer !== false;
  if (part.bones !== false || layer) {
    for (let k = 0; k < 3; k++) {
      if (part.bones !== false) bones.push(m.pos, 0.0015);
      if (layer) muscles.push(m.pos, 0.001, skip);
      relax(m, part.smooth ?? 2);
    }
    if (part.bones !== false) bones.push(m.pos, 0.001);
    if (layer) muscles.push(m.pos, 0.0006, skip);
  }
  if (skin && layer) {
    skin.push(m.pos, 0.002);
    relax(m, 2);
    skin.push(m.pos, 0.002);
  }
  const g = toGeometry(m);
  if (layer) muscles.add(part.id, g.position, g.index, m.reach);
  const out = transform(g, shrink);
  total += g.index.length / 3;
  if (part.single) model.add(meshKey(part.id), out);
  else {
    model.add(meshKey(`${part.id}.L`), out);
    model.add(meshKey(`${part.id}.R`), mirror(out));
  }
}
console.log(`left-side and midline triangles: ${total}`);
if (DEBUG) {
  for (const [name, p] of debugMarks) model.add(meshKey(`debug.mark.${name}`), transform(sphere(p.toArray() as [number, number, number], 0.004), shrink));
  await model.write(path.join(process.cwd(), ".cache", "agent-out", "cat-muscular-debug.glb"));
} else {
  await model.write(OUT);
}
