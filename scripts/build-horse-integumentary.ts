/**
 * Builds public/models/horse/integumentary.glb (skin, hooves and eyes).
 * Source: "Equine Model" by Lova Dahn (Sketchfab, CC BY 4.0), a sculpted,
 * retopologised horse standing square: the body surface (split over two
 * nodes, welded here), the eyeballs and the inside of the mouth (dropped).
 *
 * Registered onto public/models/horse/skeletal.glb as the cow's scan in
 * scripts/build-cow-integumentary.ts: the legs and tail follow their axes
 * (found from their tips by geodesic distance) onto the bones' joint centres
 * and caudal vertebrae; the head moves as one piece (muzzle, chin, poll and
 * the direction between the ear tips onto the skull and mandible); the trunk
 * and neck follow a thin-plate-spline warp from cross-sections of the model
 * to the bones and organs of the same sections plus the soft tissue over
 * them. Then the surface is inflated until the bones (1.5 cm; 6 mm in the
 * distal limbs), organs (2 cm) and, when public/models/horse/muscular.glb
 * exists, the muscles (5 mm) are inside it, and smoothed. Fidelity "modeled".
 *
 * - Hooves: the feet below the coronary band (7.5 cm above the sole of the
 *   distal phalanx). Illustrative: one capsule, no sole or frog detail.
 * - Eyes: the model's eyeballs, moved with the head.
 *
 * Output: atlas frame (metres, Y up, faces -Z, left -X).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { BufferAttribute, BufferGeometry, Matrix4, Quaternion, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { meshKey } from "../lib/content/mesh";
import { bake, bounds, components, createModel, download, fit, mean, points, readAtlas, readPrims, smoothNormals, transform, type Geometry } from "./lib/glb";
import { Surface, weldSimplify } from "./lib/segment";

const OUT = path.join(process.cwd(), "public", "models", "horse", "integumentary.glb");
const SKELETON = path.join(process.cwd(), "public", "models", "horse", "skeletal.glb");
const VISCERAL = path.join(process.cwd(), "public", "models", "horse", "visceral.glb");
const MUSCULAR = path.join(process.cwd(), "public", "models", "horse", "muscular.glb");
const source = { uid: "06efca4a943b48fdaa99973c674c8aa3", file: "lovadahn-equine-model.glb" };
// Total length of the skeleton, tail included: the model starts at that size.
const LENGTH = 2.48;

type V = Vector3;
const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z);

// ---------------------------------------------------------------- source

// The model faces +z with its left at +x: turned 180 deg about y, scaled to
// LENGTH (the warp sets the final size), floor at y=0. The body is split over
// Object_3 and Object_4 (welded here; the largest piece, a stray copy of a
// pastern left out); Object_5 holds the eyeballs; the rest is the inside of
// the mouth.
const turn = new Matrix4().makeRotationY(Math.PI);
const { scan, eyeballs } = await (async () => {
  const file = await download(source);
  const body = bake(await readPrims(file, (n) => n === "Object_3" || n === "Object_4"), turn);
  const b = bounds(body);
  const s = LENGTH / b.size.z;
  const place = new Matrix4().makeScale(s, s, s).multiply(new Matrix4().makeTranslation(-b.center.x, -b.min.y, -b.center.z));
  const pieces = components(weldSimplify(transform(body, place), 160_000, 0.0003)).sort((x, y) => y.index.length - x.index.length);
  const g = pieces[0];
  // Outward winding (positive signed volume).
  let volume = 0;
  const [a, c, d] = [new Vector3(), new Vector3(), new Vector3()];
  for (let i = 0; i < g.index.length; i += 3) {
    a.fromArray(g.position, g.index[i] * 3);
    c.fromArray(g.position, g.index[i + 1] * 3);
    d.fromArray(g.position, g.index[i + 2] * 3);
    volume += a.dot(c.cross(d));
  }
  if (volume < 0) for (let i = 0; i < g.index.length; i += 3) [g.index[i + 1], g.index[i + 2]] = [g.index[i + 2], g.index[i + 1]];
  const eyes = components(transform(bake(await readPrims(file, (n) => n === "Object_5"), turn), place));
  return { scan: g, eyeballs: eyes };
})();
const sk = new Surface(scan);
const P = (v: number) => sk.at(v);
const allPts = Array.from({ length: sk.nv }, (_, i) => P(i));
console.log(`scan: ${scan.index.length / 3} triangles, ${bounds(scan).size.toArray().map((x) => x.toFixed(3))}`);



// ---------------------------------------------------------------- appendages

// A protruding part found from its tip: vertices binned by geodesic distance
// from the tip (1 cm); the part ends where the bins spread wider than
// `width` (the body). Returns the centreline (bin centroids from the tip) and
// each vertex's distance.
function appendage(tip: number, width: number, maxLength = 1.2) {
  const { dist } = sk.geodesic([tip]);
  const bins: V[][] = [];
  for (let v = 0; v < sk.nv; v++) {
    const k = Math.floor(dist[v] / 0.01);
    if (k < maxLength / 0.01) (bins[k] ??= []).push(P(v));
  }
  const line: V[] = [];
  const radius: number[] = [];
  let length = 0;
  for (const [k, bin] of bins.entries()) {
    if (!bin?.length) break;
    const c = mean(bin);
    const spread = Math.max(...bin.map((p) => p.distanceTo(c)));
    if (k > 3 && spread > width) break;
    line.push(c);
    radius.push(spread);
    length = (k + 1) * 0.01;
  }
  return { line, radius, length, dist };
}

// Hooves: the lowest vertex of each foot; the four lower legs are the
// connected pieces of the surface within 20 cm of the ground.
const feet = (() => {
  const pieces = sk.runs((v) => P(v).y < 0.2).filter((r) => r.length > 200);
  if (pieces.length !== 4) throw new Error(`feet: ${pieces.length} pieces`);
  const centres = pieces.map((r) => mean(r.map(P)));
  const cz = mean(centres).z;
  const out: Record<string, number> = {};
  pieces.forEach((r, i) => {
    const pair = centres.filter((c) => c.z < cz === centres[i].z < cz);
    const key = `${centres[i].z < cz ? "thoracic" : "pelvic"}.${centres[i].x <= Math.min(...pair.map((c) => c.x)) ? "L" : "R"}`;
    out[key] = r.reduce((a, v) => (P(v).y < P(a).y ? v : a));
  });
  return out as Record<"thoracic.L" | "thoracic.R" | "pelvic.L" | "pelvic.R", number>;
})();
const legs = Object.fromEntries(Object.entries(feet).map(([k, v]) => [k, appendage(v, 0.18)])) as Record<keyof typeof feet, ReturnType<typeof appendage>>;
for (const [k, l] of Object.entries(legs)) console.log(`leg ${k}: ${(l.length * 100).toFixed(0)} cm, top ${l.line.at(-1)!.toArray().map((x) => x.toFixed(3))}`);

let tailTip = 0;
for (let v = 0; v < sk.nv; v++) if (P(v).z > P(tailTip).z) tailTip = v;
const tail = appendage(tailTip, 0.06);
console.log(`tail: ${(tail.length * 100).toFixed(0)} cm, root ${tail.line.at(-1)!.toArray().map((x) => x.toFixed(3))}`);

// ---------------------------------------------------------------- target

const bones = await readAtlas(SKELETON);
const organs = existsSync(VISCERAL) ? await readAtlas(VISCERAL) : new Map<string, Geometry>();
const muscles = existsSync(MUSCULAR) ? await readAtlas(MUSCULAR) : new Map<string, Geometry>();
const bone = (name: string) => {
  const g = bones.get(meshKey(`horse.skeletal.${name}`));
  if (!g) throw new Error(`no bone ${name}`);
  return g;
};
// Centroid of the `frac` of a mesh's vertices furthest along `dir`.
function end(g: Geometry, dir: V, frac = 0.05) {
  const ps = points(g, 6000).sort((p, q) => q.dot(dir) - p.dot(dir));
  return mean(ps.slice(0, Math.max(1, Math.floor(ps.length * frac))));
}
const UP = v3(0, 1, 0);
const DOWN = v3(0, -1, 0);
const centroid = (g: Geometry) => mean(points(g, 4000));

// Leg axes, from the sole up: sole, fetlock, carpus or hock, elbow or stifle,
// shoulder or hip (left side; the right one is mirrored).
const legAxis = {
  thoracic: [end(bone("phalanges-thoracic.L"), DOWN), end(bone("metacarpus.L"), DOWN, 0.03), centroid(bone("carpus.L")), end(bone("humerus.L"), DOWN, 0.04), end(bone("humerus.L"), UP, 0.04)],
  pelvic: [end(bone("phalanges-pelvic.L"), DOWN), end(bone("metatarsus.L"), DOWN, 0.03), centroid(bone("tarsus.L")), end(bone("femur.L"), DOWN, 0.04), end(bone("femur.L"), UP, 0.04)],
};
for (const line of Object.values(legAxis)) line[0].y = 0;
const tailAxis = Array.from({ length: 18 }, (_, i) => centroid(bone(`vertebrae-caudal.cd${i + 1}`)));

// ---------------------------------------------------------------- articulated parts

function resample(line: V[], n: number) {
  const s = [0];
  for (let i = 1; i < line.length; i++) s.push(s[i - 1] + line[i].distanceTo(line[i - 1]));
  return Array.from({ length: n }, (_, j) => {
    const x = (s.at(-1)! * j) / (n - 1);
    let i = Math.max(1, s.findIndex((v) => v >= x));
    if (i < 0) i = line.length - 1;
    return line[i - 1].clone().lerp(line[i], Math.min(1, (x - s[i - 1]) / (s[i] - s[i - 1] || 1)));
  });
}
const lengthOf = (line: V[]) => line.slice(1).reduce((a, p, i) => a + p.distanceTo(line[i]), 0);
// Polyline cut at arc length `at`.
function cut(line: V[], at: number) {
  const out = [line[0]];
  let s = 0;
  for (let i = 1; i < line.length; i++) {
    const d = line[i].distanceTo(line[i - 1]);
    if (s + d >= at) return [...out, line[i - 1].clone().lerp(line[i], (at - s) / d)];
    s += d;
    out.push(line[i]);
  }
  return out;
}
// Rotation-minimizing frames with the first normal from `hint`.
function frames(line: V[], hint: V) {
  const t = line.map((_, i) => line[Math.min(i + 1, line.length - 1)].clone().sub(line[Math.max(i - 1, 0)]).normalize());
  const n = [hint.clone().sub(t[0].clone().multiplyScalar(hint.dot(t[0]))).normalize()];
  for (let i = 1; i < line.length; i++) n.push(n[i - 1].clone().applyQuaternion(new Quaternion().setFromUnitVectors(t[i - 1], t[i])));
  return line.map((_, i) => ({ t: t[i], n: n[i], b: t[i].clone().cross(n[i]) }));
}
const N_AXIS = 60;
// Moves the vertices of an appendage from its source centreline onto a target
// one: each vertex keeps its offset in the frame of its nearest centreline
// point (radial offsets scaled by `radial`).
function articulate(part: ReturnType<typeof appendage>, target: V[], hint: V, radial: number) {
  const src = resample(part.line, N_AXIS);
  const dst = resample(target, N_AXIS);
  const fs = frames(src, hint);
  const fd = frames(dst, hint);
  const stretch = lengthOf(dst) / lengthOf(src);
  const out = new Map<number, V>();
  for (let v = 0; v < sk.nv; v++) {
    if (part.dist[v] >= part.length) continue;
    const p = P(v);
    let best = 0;
    for (let i = 1; i < N_AXIS; i++) if (p.distanceToSquared(src[i]) < p.distanceToSquared(src[best])) best = i;
    const o = p.clone().sub(src[best]);
    const f = fs[best];
    const g = fd[best];
    out.set(v, dst[best].clone().addScaledVector(g.t, o.dot(f.t) * stretch).addScaledVector(g.n, o.dot(f.n) * radial).addScaledVector(g.b, o.dot(f.b) * radial));
  }
  return out;
}

// Overall scale: withers height of the bones (plus 4 cm of tissue) over the
// model's height at the fore legs.
const withersT = Math.max(...[4, 5, 6].flatMap((i) => points(bone(`vertebrae-thoracic.t${i}`), 2000).map((p) => p.y))) + 0.04;
const foreZ = mean([legs["thoracic.L"].line.at(-1)!, legs["thoracic.R"].line.at(-1)!]).z;
const withersS = Math.max(...allPts.filter((p) => Math.abs(p.z - foreZ) < 0.05).map((p) => p.y));
const K = withersT / withersS;
console.log(`scale ${K.toFixed(3)} (withers ${withersT.toFixed(3)} m)`);

const moved = new Map<number, { p: V; w: number }>();
for (const [key, part] of Object.entries(legs)) {
  const [limb, sideKey] = key.split(".") as ["thoracic" | "pelvic", "L" | "R"];
  let axis = legAxis[limb].map((p) => (sideKey === "R" ? p.clone().setX(-p.x) : p.clone()));
  axis = cut(axis, part.length * K);
  const m = articulate(part, axis, v3(0, 0, -1), K);
  // The geodesic band of the leg's top reaches over the brisket, the
  // shoulder and the thigh: only the leg itself moves with it.
  // Hoof (the lowest 9 cm of the model's foot): rigid, its sole on the
  // distal phalanx's, its axis from the sole to the coronet along the
  // phalanges and its toe cranial; blended into the articulated pastern over
  // the next 8 cm.
  const low = Math.min(...[...m.keys()].map((v) => P(v).y));
  const hoof = (() => {
    const ps = [...m.keys()].filter((v) => inLeg(part, v)).map(P).filter((p) => p.y < low + 0.1);
    const sb = mean(ps.filter((p) => p.y < low + 0.01));
    const st = mean(ps.filter((p) => p.y > low + 0.08));
    const toe = ps.filter((p) => p.y < low + 0.02).reduce((a, p) => (p.z < a.z ? p : a));
    const bones = points(bone(`phalanges-${limb}.L`), 4000).map((p) => (sideKey === "R" ? p.clone().setX(-p.x) : p));
    const tb = mean(bones.filter((p) => p.y < Math.min(...bones.map((q) => q.y)) + 0.01)).setY(0);
    const tt = mean(bones.filter((p) => Math.abs(p.y - 0.085) < 0.01));
    const basis = (a: V, toward: V) => {
      const ax = a.clone().normalize();
      const c = toward.clone().sub(ax.clone().multiplyScalar(toward.dot(ax))).normalize();
      return new Matrix4().makeBasis(ax, c, ax.clone().cross(c));
    };
    const from = basis(st.clone().sub(sb), toe.clone().sub(sb).setY(0));
    const to = basis(tt.clone().sub(tb), v3(0, 0, -1));
    const k = K;
    const r = to.multiply(from.transpose());
    return (p: V) => p.clone().sub(sb).applyMatrix4(r).multiplyScalar(k).add(tb);
  })();
  for (const [v, p] of m) {
    if (!inLeg(part, v)) continue;
    const f = part.dist[v] / part.length;
    const h = Math.min(1, Math.max(0, (P(v).y - low - 0.09) / 0.08));
    moved.set(v, { p: hoof(P(v)).lerp(p, h * h * (3 - 2 * h)), w: Math.min(1, Math.max(0, (1 - f) / 0.12)) });
  }
}
{
  // Tail: root at Cd1, the hair beyond Cd18.
  const axis = [...tailAxis];
  const last = axis.at(-1)!.clone().sub(axis.at(-2)!).normalize();
  axis.push(axis.at(-1)!.clone().addScaledVector(last, 0.12));
  const m = articulate({ ...tail, line: [...tail.line].reverse(), dist: tail.dist }, axis, v3(1, 0, 0), K * 0.9);
  for (const [v, p] of m) moved.set(v, { p, w: Math.min(1, Math.max(0, (1 - tail.dist[v] / tail.length) / 0.25)) });
}
// ---------------------------------------------------------------- head and trunk

// Leg vertices are those of the geodesic band near the leg's centreline (the
// band also reaches over the brisket, the chest and the thighs).
function inLeg(a: ReturnType<typeof appendage>, v: number) {
  if (a.dist[v] >= a.length) return false;
  const p = P(v);
  let best = 0;
  for (let i = 1; i < a.line.length; i++) if (p.distanceToSquared(a.line[i]) < p.distanceToSquared(a.line[best])) best = i;
  // The top bins spread over the trunk: their radius is capped at 1.5 times
  // the leg's median.
  const median = [...a.radius].sort((x, y) => x - y)[a.radius.length >> 1];
  return p.distanceTo(a.line[best]) < Math.min(a.radius[best], median * 1.5) * 1.3 + 0.01;
}
const legVerts = new Uint8Array(sk.nv);
for (const a of Object.values(legs)) for (let v = 0; v < sk.nv; v++) if (inLeg(a, v)) legVerts[v] = 1;
const inPart = (v: number) => legVerts[v] === 1 || tail.dist[v] < tail.length;

// Head: a similarity from the muzzle, chin, poll and the direction between
// the ear tips (the ears are the highest points of the model).
const headMap = (() => {
  const zMin = bounds(scan).min.z;
  const head = allPts.filter((p) => p.z < zMin + 0.6);
  const nose = head.reduce((a, p) => (p.z < a.z ? p : a));
  const chin = head.filter((p) => p.z < nose.z + 0.15).reduce((a, p) => (p.y < a.y ? p : a));
  // Ear tips: the highest point on each side; the poll is the top of the
  // head between their bases.
  const top = head.filter((p) => p.z > nose.z + 0.3);
  const earL = top.filter((p) => p.x < 0).reduce((a, p) => (p.y > a.y ? p : a));
  const earR = top.filter((p) => p.x > 0).reduce((a, p) => (p.y > a.y ? p : a));
  const mid = earL.clone().add(earR).multiplyScalar(0.5);
  const poll = head.filter((p) => Math.abs(p.x) < 0.02 && Math.abs(p.z - mid.z) < 0.04).reduce((a, p) => (p.y > a.y ? p : a));
  const lat = earR.clone().sub(earL).setY(0).normalize().multiplyScalar(0.1);
  const skull = points(bone("skull"), 20000);
  const noseT = skull.reduce((a, p) => (p.z < a.z ? p : a)).clone().add(v3(0, -0.02, -0.04));
  const chinT = points(bone("mandible"), 8000).reduce((a, p) => (p.z < a.z ? p : a)).clone().add(v3(0, -0.04, -0.01));
  const pollT = skull.filter((p) => Math.abs(p.x) < 0.02).reduce((a, p) => (p.y > a.y ? p : a)).clone().add(v3(0, 0.015, 0));
  const latT = v3(0.1, 0, 0);
  const src = [nose, chin, poll, poll.clone().add(lat), poll.clone().sub(lat)];
  const dst = [noseT, chinT, pollT, pollT.clone().add(latT), pollT.clone().sub(latT)];
  const m = fit(src, dst, true);
  return { m, region: (p: V) => p.z < poll.z + 0.05, pollZ: poll.z, pollT };
})();

// Trunk: cross-sections at stations every 4 cm from the point of the
// shoulder to the pin bones. Scan and skeleton are matched piecewise
// linearly through the elbows and stifles (scan: the tops of the free legs)
// and the rear end of the rump. On the scan the dorsal, ventral and two
// lateral extremes of each section (legs and tail left out); on the skeleton
// the bones and organs of the section plus the soft tissue.
const elbowT = legAxis.thoracic[3].z;
const stifleT = legAxis.pelvic[3].z;
const elbowS = mean([legs["thoracic.L"].line.at(-1)!, legs["thoracic.R"].line.at(-1)!]).z;
const stifleS = mean([legs["pelvic.L"].line.at(-1)!, legs["pelvic.R"].line.at(-1)!]).z;
const inner = [...[...bones].filter(([n]) => !/skull|mandible|caudal|phalanges|meta|carpus|tarsus/.test(n)), ...organs].map(([, g]) => points(g, 3000)).flat();
// The ventral outline comes from the trunk alone (the forearms and legs reach
// far below the brisket and belly).
const core = [...[...bones].filter(([n]) => /vertebrae-(thoracic|lumbar)|sacrum|ribs|sternum|os-coxae/.test(n)), ...organs].map(([, g]) => points(g, 3000)).flat();
const trunkPts = allPts.filter((_, v) => !inPart(v) && !headMap.region(P(v)));
const frontT = Math.min(...points(bone("humerus.L"), 3000).map((p) => p.z)) - 0.03;
const rearT = Math.max(...points(bone("os-coxae.L"), 3000).map((p) => p.z)) + 0.02;
const rearS = Math.max(...trunkPts.filter((p) => p.y > 0.8).map((p) => p.z)) - 0.01;
const frontS = elbowS - (elbowT - frontT) / K;
const toSource = (z: number) => {
  const [a, b, c, d] = [frontT, elbowT, stifleT, rearT];
  const [e, f, g, h] = [frontS, elbowS, stifleS, rearS];
  return z < b ? e + ((z - a) * (f - e)) / (b - a) : z < c ? f + ((z - b) * (g - f)) / (c - b) : g + ((z - c) * (h - g)) / (d - c);
};
console.log(`trunk: skeleton ${[frontT, elbowT, stifleT, rearT].map((z) => z.toFixed(3))}, scan ${[frontS, elbowS, stifleS, rearS].map((z) => z.toFixed(3))}`);
// Dorsal outline cranial to the withers: straight from the poll to the top
// of the highest spinous process (T3-T7, plus the tissue).
const withers = [3, 4, 5, 6, 7]
  .map((i) => points(bone(`vertebrae-thoracic.t${i}`), 3000).reduce((a, p) => (p.y > a.y ? p : a)))
  .reduce((a, p) => (p.y > a.y ? p : a))
  .clone()
  .setX(0)
  .add(v3(0, 0.045, 0));
const nape = (z: number) => headMap.pollT.y + ((withers.y - headMap.pollT.y) * (z - headMap.pollT.z)) / (withers.z - headMap.pollT.z);
const pairs: [V, V][] = [];
for (let zt = frontT; zt <= rearT + 1e-6; zt += 0.04) {
  const zs = toSource(zt);
  const t = (zt - elbowT) / (stifleT - elbowT);
  const src = trunkPts.filter((p) => Math.abs(p.z - zs) < 0.01);
  const dst = inner.filter((p) => Math.abs(p.z - zt) < 0.015);
  if (src.length < 50 || dst.length < 20) continue;
  const top = src.reduce((a, p) => (p.y > a.y ? p : a));
  const cx = mean(src).x;
  // Ventral midline: the forelegs stand close to the brisket, so it is
  // taken from every vertex of the median strip, legs included (they never
  // reach the median plane).
  const strip = allPts.filter((p) => Math.abs(p.z - zs) < 0.01 && Math.abs(p.x) < 0.015 && p.y > 0.3);
  const bottom = (strip.length ? strip : src.filter((p) => Math.abs(p.x - cx) < 0.06)).reduce((a, p) => (p.y < a.y ? p : a));
  const dTop = Math.max(...dst.map((p) => p.y)) + 0.045;
  const dBottom = Math.min(...core.filter((p) => Math.abs(p.z - zt) < 0.015).map((p) => p.y)) - 0.05;
  const dHalf = Math.max(...dst.map((p) => Math.abs(p.x))) + 0.04;
  pairs.push([top, v3(0, zt < withers.z ? Math.max(dTop, nape(zt)) : dTop, zt)]);
  // Between the thighs (mammary gland, flank folds): no ventral landmark.
  if (t < 0.75) pairs.push([bottom, v3(0, dBottom, zt)]);
  const band = src.filter((p) => p.y > bottom.y + 0.3 * (top.y - bottom.y) && p.y < top.y - 0.15 * (top.y - bottom.y));
  if (!band.length) continue;
  for (const sign of [-1, 1]) {
    const q = band.reduce((a, p) => (p.x * sign > a.x * sign ? p : a));
    const f = (q.y - bottom.y) / (top.y - bottom.y);
    pairs.push([q, v3(sign * dHalf, dBottom + f * (dTop - dBottom), zt)]);
  }
}
// Neck: sections of the scan between the head and the first trunk station,
// onto lines from the poll and the throat to that station's dorsal and
// ventral landmarks (the throat is ventral to the mandibular angles, the
// brisket ventral to the manubrium), with the width eased from the head's.
{
  const first = pairs.slice(0, 4);
  const [topS, topT] = first[0];
  const [bottomS, bottomT] = first[1];
  const halfT = first[2][1].x * -1;
  const pollT = headMap.pollT.clone();
  const mand = points(bone("mandible"), 6000);
  const throatT = mand.reduce((a, p) => (p.z > a.z ? p : a)).clone().setX(0).add(v3(0, -0.07, 0.03));
  const brisketT = bottomT.clone();
  const skullHalf = Math.max(...points(bone("skull"), 6000).map((p) => Math.abs(p.x))) * 0.6;
  const z0 = headMap.pollZ + 0.06;
  const z1 = Math.min(topS.z, bottomS.z) - 0.02;
  for (let u = 0; u <= 1.001; u += 0.2) {
    const zs = z0 + u * (z1 - z0);
    const src = trunkPts.filter((p) => Math.abs(p.z - zs) < 0.01);
    if (src.length < 50) continue;
    const top = src.reduce((a, p) => (p.y > a.y ? p : a));
    const bottom = src.reduce((a, p) => (p.y < a.y ? p : a));
    const dTop = pollT.clone().lerp(topT, 0.15 + 0.85 * u);
    const dBottom = throatT.clone().lerp(brisketT, u);
    pairs.push([top, dTop], [bottom, dBottom]);
    const band = src.filter((p) => p.y > bottom.y + 0.3 * (top.y - bottom.y) && p.y < top.y - 0.2 * (top.y - bottom.y));
    const half = skullHalf + (halfT - skullHalf) * u;
    for (const sign of [-1, 1]) {
      const q = band.reduce((a, p) => (p.x * sign > a.x * sign ? p : a));
      const f = (q.y - bottom.y) / (top.y - bottom.y);
      pairs.push([q, dBottom.clone().lerp(dTop, f).setX(sign * half)]);
    }
  }
}
// Head: evenly spaced vertices, moved rigidly.
const headPts = allPts.filter((p) => headMap.region(p));
for (let i = 0; i < headPts.length; i += Math.floor(headPts.length / 40)) pairs.push([headPts[i], headPts[i].clone().applyMatrix4(headMap.m)]);
// Leg tops and tail root: their articulated positions.
for (const part of [...Object.values(legs), tail]) {
  const band = [...moved].filter(([v]) => part.dist[v] > 0.8 * part.length && part.dist[v] < 0.88 * part.length);
  for (let i = 0; i < band.length; i += Math.max(1, Math.floor(band.length / 12))) pairs.push([P(band[i][0]), band[i][1].p]);
}
console.log(`landmarks: ${pairs.length}`);

function tps(list: [V, V][], lambda: number) {
  const n = list.length;
  const m = n + 4;
  const a = new Float64Array(m * m);
  const b = new Float64Array(m * 3);
  for (let i = 0; i < n; i++) {
    const si = list[i][0];
    for (let j = 0; j < n; j++) a[i * m + j] = i === j ? lambda : si.distanceTo(list[j][0]);
    const row = [1, si.x, si.y, si.z];
    for (let k = 0; k < 4; k++) {
      a[i * m + n + k] = row[k];
      a[(n + k) * m + i] = row[k];
    }
    b.set(list[i][1].toArray(), i * 3);
  }
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(a[r * m + c]) > Math.abs(a[p * m + c])) p = r;
    if (p !== c) {
      for (let k = 0; k < m; k++) [a[c * m + k], a[p * m + k]] = [a[p * m + k], a[c * m + k]];
      for (let k = 0; k < 3; k++) [b[c * 3 + k], b[p * 3 + k]] = [b[p * 3 + k], b[c * 3 + k]];
    }
    for (let r = c + 1; r < m; r++) {
      const f = a[r * m + c] / a[c * m + c];
      if (f === 0) continue;
      for (let k = c; k < m; k++) a[r * m + k] -= f * a[c * m + k];
      for (let k = 0; k < 3; k++) b[r * 3 + k] -= f * b[c * 3 + k];
    }
  }
  const w = new Float64Array(m * 3);
  for (let r = m - 1; r >= 0; r--)
    for (let k = 0; k < 3; k++) {
      let sum = b[r * 3 + k];
      for (let c = r + 1; c < m; c++) sum -= a[r * m + c] * w[c * 3 + k];
      w[r * 3 + k] = sum / a[r * m + r];
    }
  const centres = list.map(([p]) => p);
  return (p: V) => {
    const out = [0, 1, 2].map((k) => w[n * 3 + k] + w[(n + 1) * 3 + k] * p.x + w[(n + 2) * 3 + k] * p.y + w[(n + 3) * 3 + k] * p.z);
    for (let j = 0; j < n; j++) {
      const r = p.distanceTo(centres[j]);
      for (let k = 0; k < 3; k++) out[k] += w[j * 3 + k] * r;
    }
    return v3(out[0], out[1], out[2]);
  };
}

// Final position: the head moved rigidly (fading into the warp over 8 cm
// behind the poll), the legs and tail articulated (fading into the warp near
// their roots), the rest warped.
const warp = tps(pairs, 0.002);
const warped = new Float32Array(sk.nv * 3);
for (let v = 0; v < sk.nv; v++) {
  const p = P(v);
  const h = Math.min(1, Math.max(0, (headMap.pollZ + 0.08 - p.z) / 0.08));
  let q = h > 0 ? p.clone().applyMatrix4(headMap.m) : warp(p);
  if (h > 0 && h < 1) q = warp(p).lerp(q, h * h * (3 - 2 * h));
  const a = moved.get(v);
  (a ? a.p.clone().lerp(q, 1 - a.w) : q).toArray(warped, v * 3);
}

// ---------------------------------------------------------------- push-out

// Inflates the skin until every obstacle point lies at least its clearance
// inside the surface: each vertex moves out along its normal, by what the
// points behind or outside it need, spread smoothly over the neighbouring
// vertices (moving only outwards, so thin parts such as the legs swell
// instead of shifting).
function pushOut(position: Float32Array, index: Uint32Array, obstacles: { p: V; c: number; reach?: number }[]) {
  const n = position.length / 3;
  const ring = new Sculpt(index, n);
  const hit = { point: new Vector3(), distance: 0, faceIndex: 0 };
  // Folds where limbs meet the trunk stop it converging: the best pass is kept.
  let best = { bad: Infinity, position: position.slice() };
  for (let pass = 0; pass < 8; pass++) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(position, 3));
    geometry.setIndex(new BufferAttribute(index, 1));
    const bvh = new MeshBVH(geometry);
    const normal = ring.smoothVectors(smoothNormals(position, index), 10);
    const need = new Float32Array(n);
    let bad = 0;
    let worst = 0;
    for (const { p, c, reach = 0.03 } of obstacles) {
      bvh.closestPointToPoint(p, hit);
      if (hit.distance > reach + 0.01) continue;
      const f = hit.faceIndex * 3;
      const [a, b, d] = [index[f], index[f + 1], index[f + 2]].map((i) => v3(position[i * 3], position[i * 3 + 1], position[i * 3 + 2]));
      const side = p.clone().sub(hit.point).dot(b.clone().sub(a).cross(d.clone().sub(a)));
      const depth = side < 0 ? hit.distance : -hit.distance; // how far inside
      // Further outside than `reach`: a registration miss, not for the push-out.
      if (depth >= c || depth < -reach) continue;
      bad++;
      worst = Math.max(worst, c - depth);
      for (const v of [index[f], index[f + 1], index[f + 2]]) need[v] = Math.max(need[v], c - depth);
    }
    console.log(`push-out pass ${pass}: ${bad} points closer than their clearance, worst ${(worst * 1000).toFixed(0)} mm`);
    if (bad < best.bad) best = { bad, position: position.slice() };
    if (bad === 0 || bad > best.bad * 1.15) break;
    const amount = ring.spreadScalar(need, 30);
    for (let v = 0; v < n; v++) {
      const k = Math.min(amount[v], 0.008);
      for (let j = 0; j < 3; j++) position[v * 3 + j] += normal[v * 3 + j] * k;
    }
  }
  position.set(best.position);
  console.log(`push-out: kept the pass with ${best.bad} points`);
}

// Vertex rings of a mesh, for smoothing a field over the surface.
class Sculpt {
  readonly nb: number[][];
  constructor(index: Uint32Array, n: number) {
    const sets: Set<number>[] = Array.from({ length: n }, () => new Set());
    for (let i = 0; i < index.length; i += 3)
      for (let k = 0; k < 3; k++) {
        sets[index[i + k]].add(index[i + ((k + 1) % 3)]);
        sets[index[i + k]].add(index[i + ((k + 2) % 3)]);
      }
    this.nb = sets.map((s) => [...s]);
  }
  // Unit vectors averaged over the rings.
  smoothVectors(f: Float32Array, iterations: number) {
    for (let it = 0; it < iterations; it++) {
      const next = new Float32Array(f.length);
      for (let v = 0; v < this.nb.length; v++) {
        const s = [f[v * 3], f[v * 3 + 1], f[v * 3 + 2]];
        for (const u of this.nb[v]) for (let k = 0; k < 3; k++) s[k] += f[u * 3 + k];
        const l = Math.hypot(...s) || 1;
        for (let k = 0; k < 3; k++) next[v * 3 + k] = s[k] / l;
      }
      f = next;
    }
    return f;
  }
  // Averages a scalar field over the rings, never below what each vertex needs.
  spreadScalar(need: Float32Array, iterations: number) {
    let f = need.slice();
    for (let it = 0; it < iterations; it++) {
      const next = new Float32Array(f.length);
      for (let v = 0; v < this.nb.length; v++) {
        const ring = this.nb[v];
        let s = 0;
        for (const u of ring) s += f[u];
        next[v] = Math.max(need[v], ring.length ? (s / ring.length + f[v]) / 2 : f[v]);
      }
      f = next;
    }
    return f;
  }

}

const obstacles: { p: V; c: number; reach?: number }[] = [];
for (const [name, g] of bones) {
  const c = /skull|mandible/.test(name) ? 0.004 : /phalanges|meta|carpus|tarsus/.test(name) ? 0.006 : 0.015;
  // The sole of the distal phalanx is the floor: no push-out under it.
  for (const p of points(g, 1500)) if (p.y > 0.015) obstacles.push({ p, c, reach: /skull/.test(name) ? 0.05 : 0.03 });
}
for (const [name, g] of organs) if (!/brain/.test(name)) for (const p of points(g, 1500)) obstacles.push({ p, c: 0.02 });
for (const g of muscles.values()) for (const p of points(g, 800)) obstacles.push({ p, c: 0.005 });
// Folds of the warp (where the raised neck of the model meets the withers,
// and over the shoulders): triangles turned against their neighbours, plus
// 2 rings around them, are relaxed towards their neighbours' average before
// the push-out.
{
  const ring = new Sculpt(sk.I, sk.nv);
  const area = (pos: Float32Array | ((v: number) => V), t: number) => {
    const at = (v: number) => (typeof pos === "function" ? pos(v) : v3(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]));
    const [a, b, c] = [sk.I[t], sk.I[t + 1], sk.I[t + 2]].map(at);
    return b.clone().sub(a).cross(c.clone().sub(a));
  };
  const normal = ring.smoothVectors(smoothNormals(warped, sk.I), 4);
  const bad = new Uint8Array(sk.nv);
  for (let t = 0; t < sk.I.length; t += 3) {
    const n = area(warped, t);
    const tri = [sk.I[t], sk.I[t + 1], sk.I[t + 2]];
    const avg = tri.reduce((acc, v) => acc.add(v3(normal[v * 3], normal[v * 3 + 1], normal[v * 3 + 2])), v3(0, 0, 0));
    if (n.dot(avg) < 0) for (const v of tri) bad[v] = 1;
  }
  for (let r = 0; r < 2; r++) {
    const grow = bad.slice();
    for (let v = 0; v < sk.nv; v++) if (bad[v]) for (const u of ring.nb[v]) grow[u] = 1;
    bad.set(grow);
  }
  let count = 0;
  for (let v = 0; v < sk.nv; v++) count += bad[v];
  console.log(`folds: ${count} vertices relaxed`);
  for (let it = 0; it < 60; it++) {
    const next = warped.slice();
    for (let v = 0; v < sk.nv; v++) {
      if (!bad[v]) continue;
      for (let k = 0; k < 3; k++) {
        let sum = 0;
        for (const u of ring.nb[v]) sum += warped[u * 3 + k];
        next[v * 3 + k] = sum / ring.nb[v].length;
      }
    }
    warped.set(next);
  }
}

pushOut(warped, sk.I, obstacles);

// Taubin smoothing: the folds where the legs leave the trunk (strongly) and
// the facets of the warp and push-out (everything but the head, lightly).
{
  const ring = new Sculpt(sk.I, sk.nv);
  const root = (v: number) => [...Object.values(legs), tail].some((a) => a.dist[v] > 0.7 * a.length && a.dist[v] < 1.3 * a.length);
  const body = (v: number) => P(v).z > headMap.pollZ + 0.08;
  for (let it = 0; it < 40; it++) {
    const factor = it % 2 === 0 ? 0.5 : -0.53;
    const next = warped.slice();
    for (let v = 0; v < sk.nv; v++) {
      if (!(it < 30 ? root(v) : body(v))) continue;
      for (let k = 0; k < 3; k++) {
        let sum = 0;
        for (const u of ring.nb[v]) sum += warped[u * 3 + k];
        next[v * 3 + k] += (sum / ring.nb[v].length - warped[v * 3 + k]) * factor;
      }
    }
    warped.set(next);
  }
}

// ---------------------------------------------------------------- parts

// Hooves: the leg below the coronary band, 7.5 cm above the sole of the
// distal phalanx.
const part = new Int32Array(sk.nv).fill(0);
const coronet = {
  thoracic: Math.min(...points(bone("phalanges-thoracic.L"), 4000).map((p) => p.y)) + 0.075,
  pelvic: Math.min(...points(bone("phalanges-pelvic.L"), 4000).map((p) => p.y)) + 0.075,
};
for (const [key, a] of Object.entries(legs))
  for (let v = 0; v < sk.nv; v++) if (a.dist[v] < a.length && warped[v * 3 + 1] < coronet[key.split(".")[0] as "thoracic" | "pelvic"]) part[v] = 1 + Object.keys(legs).indexOf(key);

// The triangles with at least two vertices passing `keep`.
function pick(position: Float32Array, index: Uint32Array, keep: (v: number) => boolean): Geometry {
  const remap = new Map<number, number>();
  const out: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const tri = [index[t], index[t + 1], index[t + 2]];
    if (tri.filter(keep).length < 2) continue;
    for (const v of tri) {
      if (!remap.has(v)) remap.set(v, remap.size);
      out.push(remap.get(v)!);
    }
  }
  const p = new Float32Array(remap.size * 3);
  for (const [v, j] of remap) p.set(position.subarray(v * 3, v * 3 + 3), j * 3);
  return { position: p, index: new Uint32Array(out) };
}
const skin = pick(warped, sk.I, (v) => part[v] === 0);
console.log(`skin ${skin.index.length / 3} triangles`);

// Eyes: the eyeballs move with the head (left: the one at -x).
const eyes = eyeballs.map((g) => transform(g, headMap.m)).sort((a, b) => bounds(a).center.x - bounds(b).center.x);
if (eyes.length !== 2) throw new Error(`eyes: ${eyes.length} pieces`);

const model = createModel("horse.integumentary", [0.76, 0.6, 0.47, 1], 0.04);
model.add(meshKey("horse.integumentary.skin"), skin, 70000);
for (const key of Object.keys(legs)) model.add(meshKey(`horse.integumentary.hooves.${key}`), pick(warped, sk.I, (v) => part[v] === 1 + Object.keys(legs).indexOf(key)), 3000);
model.add(meshKey("horse.integumentary.eyes.L"), eyes[0], 1500);
model.add(meshKey("horse.integumentary.eyes.R"), eyes[1], 1500);
await model.write(OUT);
