/**
 * Builds public/models/cat/muscular.glb on the bones of
 * public/models/cat/skeletal.glb (build that first).
 *
 * Most muscles are sculpted: "Feline Ecorche Dec" by westerly (CC BY 4.0),
 * split, labelled and placed on our skeleton by scripts/lib/feline-ecorche.ts
 * (fidelity "modeled"). They keep their shape and are only dented where two
 * of them overlap.
 *
 * Procedural, illustrative muscles fill what the écorché lacks: the
 * diaphragm, the omotransversarius and the vastus medialis (adapted from
 * scripts/build-dog-muscular.ts). Origins and insertions are landmarks
 * measured on the bone meshes (extreme points, points at a fraction along a
 * bone's long axis, offsets in the bone's local frame); the omotransversarius
 * and vastus medialis are tubes lofted along a Catmull-Rom curve through them,
 * the diaphragm a slab on a parametric body surface fitted to the vertebrae,
 * ribs, sternum and pelvis. Vertices that fall inside a bone or an already
 * built muscle are pushed out.
 *
 * The bones are read scaled to the size of the dog (SCALE) and the muscles
 * scaled back on output, so offsets, thicknesses, clearances and the voxel
 * size of the overlap passes are in that frame; the sculpted muscles are
 * placed at the cat's size and grown into it too. The head is carried low and
 * flexed, so head landmarks use a frame along the skull.
 *
 * Other systems are read when present: the diaphragm is fitted between the
 * liver and the heart of visceral.glb, and vertices of procedural muscles up
 * to 6 mm (dog frame) outside the skin of integumentary.glb are pulled inside
 * it.
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
import { felineEcorche } from "./lib/feline-ecorche";
import { createModel, merge, mirror, readAtlas, sphere, transform, type Geometry } from "./lib/glb";
import { AXES, Obstacles, Volume, boxOf, dir, lerp, prof, relax, slab, smoothstep, toGeometry, tube as baseTube, vec, type Dir, type Mesh, type Profile, type Tube, type V } from "./lib/muscle";

const SKELETON = path.join(process.cwd(), "public", "models", "cat", "skeletal.glb");
const VISCERA = path.join(process.cwd(), "public", "models", "cat", "visceral.glb");
const OUT = path.join(process.cwd(), "public", "models", "cat", "muscular.glb");
const DEBUG = process.argv.includes("--debug");

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
const ribPts = points(required("ribs")).filter((p) => p.x < 0);
const sternum = points(required("sternum"));
const carpusP = points(required("carpus"));
const metacarpus = new Bone(required("metacarpus"), down);
const phalangesThoracic = points(required("phalanges-thoracic"));

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

const bones = new Obstacles();
// The clavicle floats inside the brachiocephalicus: not an obstacle.
for (const [name, g] of atlas) if (!isRight(name) && !name.includes("clavicle")) bones.add(name, g.position, g.index);
const muscles = new Volume();
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
const hock = tibia.b.clone();
const calcaneus = tarsus.ext({ cau: 1, dor: 0.5 });
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
  scan?: boolean; // sculpted shape: only thinned where it runs into another sculpted one
};
const parts: Part[] = [];
let building = "";
// Tubes also mark their control points in --debug.
const tube = (t: Tube) => {
  if (DEBUG) t.pts.forEach((p, k) => mark(`${building}.${k}`, p));
  return baseTube(t);
};
const muscle = (p: Part) => parts.push(p);

// ---------------------------------------------------------------- muscles

const M = "cat.muscular";
// Evenly spaced profile knots: P(a, b, c) -> [[0, a], [0.5, b], [1, c]].
const P = (...v: number[]): Profile => v.map((x, k) => [k / (v.length - 1), x]);
const fixed = (d: Dir) => () => dir(d);

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
  // Inside the trunk wall: not pushed out through the sculpted muscles.
  ignore: [M],
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

// Thoracic limb ----------------------------------------------------------

// Omotransversarius (not in the écorché): acromion and distal spine of the
// scapula to the wing of the atlas.
const atlasWing = (() => {
  const g = skel("atlas")!;
  return argmax(points(g), { lat: 1, cau: 0.3 });
})();
muscle({
  id: `${M}.omotransversarius`,
  // The sculpted neck muscles leave it no room: it stays under them (through
  // the deep ones) rather than being pushed out over them.
  ignore: [M],
  make: () =>
    tube({
      pts: [spine(0.78, 0.003), lerp(spine(0.78), atlasWing, 0.5).add(vec(0.006, 0, 0)), atlasWing.clone().add(vec(-0.002, 0, 0))],
      w: P(0.024, 0.018, 0.01),
      t: P(0.003, 0.005, 0.004),
      face: (s) => (s < 0.15 ? scapN : AXES.lat),
    }),
});

// Pelvic limb -----------------------------------------------------------

const fd = (cr: number, lat: number) => fDir(cr, lat);

// Vastus medialis: not in the écorché (deep to the sartorius and adductor).
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

// Sculpted muscles ------------------------------------------------------

// Écorché muscles (scripts/lib/feline-ecorche.ts) keep their shape: built
// first, from deep to superficial, each thinned from inside where its hidden
// side runs into the ones before (Volume.peel); the procedural muscles make
// room for them. Read at the cat's size and grown into this frame.
const sculpted = await felineEcorche(await readAtlas(SKELETON));
for (const [key, g] of sculpted) {
  const id = key.replace(/^cat_muscular_/, "").replace(/_L$/, "").replace(/_/g, ".");
  muscle({
    id: `${M}.${id}`,
    scan: true,
    make: () => {
      const grown = transform(g, grow);
      const pos = points(grown);
      return {
        pos,
        tri: [...grown.index],
        fibre: pos.map((_, i) => vec(grown.fibre![i * 4], grown.fibre![i * 4 + 1], grown.fibre![i * 4 + 2])),
        tendon: pos.map((_, i) => grown.fibre![i * 4 + 3]),
      };
    },
  });
}


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
for (const part of [...parts.filter((p) => p.scan), ...parts.filter((p) => !p.scan)]) {
  building = part.id;
  const m = part.make();
  const skip = (owner: string) => (part.ignore ?? []).some((x) => owner.startsWith(x));
  const layer = part.layer !== false;
  if (part.scan) {
    muscles.peel(m, skip);
    relax(m, 1);
  } else if (part.bones !== false || layer) {
    for (let k = 0; k < 3; k++) {
      if (part.bones !== false) bones.push(m.pos, 0.0015);
      if (layer) muscles.push(m, 0.001, skip, 2);
      relax(m, part.smooth ?? 2);
    }
    if (part.bones !== false) bones.push(m.pos, 0.001);
    if (layer) muscles.push(m, 0.0006, skip, 2);
  }
  if (skin && layer && !part.scan) {
    skin.push(m.pos, 0.002);
    relax(m, 2);
    skin.push(m.pos, 0.002);
    muscles.push(m, 0.0006, skip, 3);
  }
  const g = toGeometry(m);
  if (layer) muscles.add(part.id, m, skip);
  const out = transform(g, shrink);
  total += g.index.length / 3;
  if (part.single) model.add(meshKey(part.id), out);
  else {
    model.add(meshKey(`${part.id}.L`), out);
    model.add(meshKey(`${part.id}.R`), mirror(out));
  }
}
console.log(`left-side and midline triangles: ${total}`);
for (const r of muscles.report(0.02)) console.warn(`overlap: ${r.a} x ${r.b} ${(r.cm3 / SCALE ** 3).toFixed(1)} cm3 (${(r.frac * 100).toFixed(0)}%)`);
if (DEBUG) {
  for (const [name, p] of debugMarks) model.add(meshKey(`debug.mark.${name}`), transform(sphere(p.toArray() as [number, number, number], 0.004), shrink));
  await model.write(path.join(process.cwd(), ".cache", "agent-out", "cat-muscular-debug.glb"));
} else {
  await model.write(OUT);
}
