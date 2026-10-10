/**
 * Builds public/models/cat/skeletal.glb. Sources:
 * - "Feline Skeleton Dec" by westerly (Sketchfab, CC BY 4.0): a ZBrush sculpt
 *   of a whole standing cat in which every bone is a separate, unnamed shell.
 *   The shells are split by connectivity and labelled by position below
 *   (fidelity "modeled"). Both sides are kept as sculpted.
 * - RISD Nature Lab scans (Sketchfab, CC BY 4.0) of Felis catus replace the
 *   sculpted skull and mandible: "Domestic cat cranium" (a sagittal half of
 *   specimen 18.85, mirrored; "Domestic Cat Skull (full)" of the same
 *   specimen is only used to place it, it lacks teeth and arches) and
 *   "Domestic Cat Jaw" (specimen 439.03, a smaller cat: it is scaled up about
 *   28% to fit). Registered onto the sculpt by ICP with a free scale.
 * - Modeled here (illustrative): the hyoid apparatus, missing from the
 *   sculpt, as thin rods from the tympanic bullae to the larynx; and the
 *   vestigial clavicles, small curved rods cranial to the shoulder joints.
 *
 * Downloads go to .cache/models/ (needs SKETCHFAB_TOKEN in .env.local). The
 * sculpt is in arbitrary units (about 3.9 long, tail included), Y up, the cat
 * facing +Z with its left side at +X; it is rotated 180° about Y and scaled to
 * a nose-to-rump length of NOSE_TO_RUMP.
 *
 * Output conventions: metres, Y up, floor at y=0, animal faces -Z, animal's
 * left side is -X. One mesh per structure (or per side, vertebra, rib or
 * sternebra) named with meshKey().
 */
import path from "node:path";
import { Matrix4, Quaternion, Vector3 } from "three";
import { meshKey } from "../lib/content/mesh";
import { bake, bounds, capsule, components, createModel, download, mean, merge, mirror, pca, pcaStarts, points, readPrims, register, transform, type Geometry, type Vec } from "./lib/glb";

const OUT = path.join(process.cwd(), "public", "models", "cat", "skeletal.glb");
const NOSE_TO_RUMP = 0.46;

const sources = {
  sculpt: { uid: "a5d0bb8f55dc4f49b103cd20d65e0b17", file: "westerly-feline-skeleton.glb" },
  skull: { uid: "42f9f5f91f1844688bf717a59586da40", file: "risd-cat-skull-full.glb" },
  cranium: { uid: "e7d863ba4eb342dba7602a7adaacad11", file: "risd-cat-cranium.glb" },
  mandible: { uid: "94cc7033cd1549398ae26118d6edd086", file: "risd-cat-mandible.glb" },
};

type V = Vector3;
type Shell = { g: Geometry; min: V; max: V; center: V; size: V; tris: number };

const shell = (g: Geometry): Shell => ({ g, ...bounds(g), tris: g.index.length / 3 });
const diag = (s: Shell) => s.size.length();
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

// Centroid of the `frac` of a mesh's vertices with the largest projection on `dir`.
function end(g: Geometry, dir: V, frac = 0.1) {
  const ps = points(g, 4000).sort((p, q) => q.dot(dir) - p.dot(dir));
  const n = Math.max(1, Math.floor(ps.length * frac));
  return ps.slice(0, n).reduce((a, p) => a.add(p), new Vector3()).divideScalar(n);
}

// ---------------------------------------------------------------------------
// Sculpt: shells in the atlas orientation (still in sculpt units).

const sculpt = components(bake(await readPrims(await download(sources.sculpt)), new Matrix4().makeRotationY(Math.PI))).map(shell);
const length = bounds(merge(sculpt.map((s) => s.g))).size.z;
console.log(`sculpt: ${sculpt.length} shells, length ${length.toFixed(3)}`);
const pool = new Set(sculpt);
const take = (s: Shell) => (pool.delete(s), s);
const isMedian = (s: Shell) => Math.abs(s.center.x) < length * 0.004;
const byZ = (a: Shell, b: Shell) => a.center.z - b.center.z;

// Head: the largest shell is the skull; the mandible is the largest median
// shell under it. Every other shell inside them is a tooth and goes with the
// nearer of the two, as registration targets only (the scans have teeth).
const skullS = take(sculpt[0]);
const mandibleS = take([...pool].filter((s) => isMedian(s) && inside(s.center, skullS, length * 0.02))[0]);
const teeth = [...pool].filter((s) => diag(s) < length * 0.03 && (inside(s.center, skullS, length * 0.01) || inside(s.center, mandibleS, length * 0.01)));
teeth.forEach(take);
const upperTeeth = teeth.filter((t) => gap(t.g, skullS.g, 200) < gap(t.g, mandibleS.g, 200));
console.log(`teeth: ${teeth.length} (${upperTeeth.length} upper)`);

// Both hip bones are one shell (fused at the pelvic symphysis): the largest
// median shell caudal to the middle of the body.
const pelvisS = take([...pool].filter((s) => isMedian(s) && s.center.z > 0).sort((a, b) => b.tris - a.tris)[0]);

// Sternebrae: median shells ventral to the pelvis level and cranial to it.
const sternum = [...pool].filter((s) => isMedian(s) && s.center.z < pelvisS.min.z && s.center.y < pelvisS.min.y).sort(byZ);
sternum.forEach(take);

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
// Atlas, axis, C3-C7, T1-T13, L1-L7, sacrum, then the tail.
const CERVICAL = 7;
const THORACIC = 13;
const LUMBAR = 7;
const sacrumAt = CERVICAL + THORACIC + LUMBAR;
const sacrumS = spine[sacrumAt];
if (!inside(sacrumS.center, pelvisS) || spine.slice(0, sacrumAt).some((s) => s.tris > sacrumS.tris)) throw new Error("vertebral count does not end at the sacrum");
const caudal = spine.slice(sacrumAt + 1);
console.log(`spine: ${spine.length} shells, ${caudal.length} caudal vertebrae, ${sternum.length} sternebrae`);

// ---------------------------------------------------------------------------
// Paired bones, labelled per side the same way (both sides are sculpted).

const splitZ = (spine[CERVICAL].center.z + sacrumS.center.z) / 2;
const vertebraCenters = spine.slice(0, sacrumAt).map((s) => s.center);

function side(sign: number) {
  const mine = [...pool].filter((s) => Math.sign(s.center.x) === sign);
  const out = new Map<string, Geometry>();
  const used = new Set<Shell>();
  const claim = (s: Shell) => (used.add(s), s);
  const free = () => mine.filter((s) => !used.has(s));

  // Long bones: the large shells lateral to the rib cage.
  const long = mine.filter((s) => Math.abs(s.center.x) > length * 0.046 && diag(s) > length * 0.1);
  const fore = long.filter((s) => s.center.z < splitZ).sort((a, b) => b.center.y - a.center.y);
  const hind = long.filter((s) => s.center.z >= splitZ).sort((a, b) => b.center.y - a.center.y);
  if (fore.length !== 4 || hind.length !== 3) throw new Error(`long bones: ${fore.length} thoracic, ${hind.length} pelvic`);
  const [scapula, humerus, ...forearm] = fore.map(claim);
  const [ulna, radius] = forearm.sort((a, b) => b.max.y - a.max.y);
  const [femur, ...crus] = hind.map(claim);
  const vol = (s: Shell) => s.size.x * s.size.y * s.size.z;
  const [tibia, fibula] = crus.sort((a, b) => vol(b) - vol(a));
  out.set("scapula", scapula.g).set("humerus", humerus.g).set("radius", radius.g).set("ulna", ulna.g);
  out.set("femur", femur.g).set("tibia", tibia.g).set("fibula", fibula.g);

  const patella = free().filter((s) => diag(s) < length * 0.03 && inside(s.center, femur, length * 0.02));
  if (patella.length !== 1) throw new Error(`patella: ${patella.length} candidates`);
  out.set("patella", claim(patella[0]).g);

  // Paws: everything below the middle of the forearm or crus.
  const paw = (shells: Shell[], fore: boolean) => {
    const sorted = shells.map((s) => ({ s, ext: Math.max(s.size.y, s.size.z) })).sort((a, b) => b.ext - a.ext);
    const meta = sorted.slice(0, 4).map((x) => x.s);
    const mid = meta.reduce((a, s) => a + s.center.y, 0) / 4;
    const innerX = Math.min(...meta.map((s) => Math.abs(s.center.x)));
    const rest = shells.filter((s) => !meta.includes(s));
    // Thoracic digit I (dewclaw) sits medial to the other metacarpals and
    // off the ground: its highest shell is metacarpal I, the rest phalanges.
    const dew = fore ? rest.filter((s) => Math.abs(s.center.x) < innerX - length * 0.002 && s.center.y > mid - length * 0.01).sort((a, b) => b.center.y - a.center.y) : [];
    const upper = rest.filter((s) => !dew.includes(s) && s.center.y > mid);
    const lower = rest.filter((s) => !dew.includes(s) && s.center.y <= mid);
    return { proximal: upper, meta: [...meta, ...dew.slice(0, 1)], digits: [...lower, ...dew.slice(1)] };
  };
  const low = free().filter((s) => s.center.y < Math.min(radius.center.y, tibia.center.y));
  const manus = paw(low.filter((s) => s.center.z < splitZ).map(claim), true);
  const pes = paw(low.filter((s) => s.center.z >= splitZ).map(claim), false);
  const g = (ss: Shell[]) => merge(ss.map((s) => s.g));
  out.set("carpus", g(manus.proximal)).set("metacarpus", g(manus.meta)).set("phalanges-thoracic", g(manus.digits));
  out.set("tarsus", g(pes.proximal)).set("metatarsus", g(pes.meta)).set("phalanges-pelvic", g(pes.digits));
  console.log(`paws ${sign < 0 ? "L" : "R"}: carpus ${manus.proximal.length}, metacarpus ${manus.meta.length}, phalanges ${manus.digits.length}; tarsus ${pes.proximal.length}, metatarsus ${pes.meta.length}, phalanges ${pes.digits.length}`);

  // Ribs: bony ribs reach the vertebral bodies, costal cartilages do not.
  // Ribs are numbered by the craniocaudal position of the head; each
  // cartilage joins the rib whose shell it touches.
  const trunk = free().filter((s) => s.center.z < splitZ + length * 0.05);
  const reach = (s: Shell) => Math.min(...points(s.g, 600).map((p) => Math.min(...vertebraCenters.map((c) => c.distanceTo(p)))));
  const bony = trunk.filter((s) => reach(s) < length * 0.04);
  const cartilages = trunk.filter((s) => !bony.includes(s));
  const head = (s: Shell) => points(s.g, 2000).sort((a, b) => Math.abs(a.x) - Math.abs(b.x))[0];
  bony.sort((a, b) => head(a).z - head(b).z);
  if (bony.length !== THORACIC) throw new Error(`ribs: ${bony.length}`);
  const ribs = bony.map((s) => [claim(s)]);
  for (const c of cartilages) {
    const d = bony.map((r) => gap(c.g, r.g, 300));
    ribs[d.indexOf(Math.min(...d))].push(claim(c));
  }
  if (ribs.some((r) => r.length !== 2)) console.warn(`cartilages per rib: ${ribs.map((r) => r.length - 1).join(" ")}`);
  ribs.forEach((r, i) => out.set(`ribs.${i + 1}`, g(r)));

  const left = free();
  if (left.length) console.warn(`unlabelled shells (${sign < 0 ? "L" : "R"}): ${left.map((s) => `${s.tris}@${s.center.toArray().map((x) => x.toFixed(2))}`).join(" ")}`);
  return out;
}
const paired = { L: side(-1), R: side(1) };

// Hip bones: the pelvis shell cut at the median plane.
paired.L.set("os-coxae", subset(pelvisS.g, (c) => c.x < 0));
paired.R.set("os-coxae", subset(pelvisS.g, (c) => c.x >= 0));

// ---------------------------------------------------------------------------
// Scale to a domestic cat, floor at y=0, nose-to-rump centred on z=0.

const rumpZ = pelvisS.max.z;
const k = NOSE_TO_RUMP / (rumpZ - skullS.min.z);
const floorY = Math.min(...[...paired.L.values(), ...paired.R.values()].map((g) => bounds(g).min.y));
const toAtlas = new Matrix4().makeScale(k, k, k).multiply(new Matrix4().makeTranslation(0, -floorY, -(rumpZ + skullS.min.z) / 2));
const place = (g: Geometry) => transform(g, toAtlas);
for (const map of Object.values(paired)) for (const [key, g] of map) map.set(key, place(g));
// Withers: top of the spinous processes of T1-T3.
const withers = (Math.max(...spine.slice(CERVICAL, CERVICAL + 3).map((s) => s.max.y)) - floorY) * k;
console.log(`scale ${k.toFixed(4)} m/unit, withers ${(withers * 100).toFixed(1)} cm`);

// ---------------------------------------------------------------------------
// Skull and mandible scans (millimetres, arbitrary orientation), registered
// onto the sculpted skull + upper teeth and mandible + lower teeth.

async function scan(source: { uid: string; file: string }, target: Geometry, label: string) {
  const g = bake(await readPrims(await download(source)), new Matrix4());
  const { m, rms } = register(g, target, pcaStarts(g, target, true), { withScale: true });
  const scale = Math.cbrt(Math.abs(m.determinant()));
  console.log(`${label}: ICP rms ${(rms * 1000).toFixed(2)} mm, scan scale ${(scale * 1000).toFixed(3)} (1 = life size)`);
  return { g: transform(g, m), scale };
}
const skullTarget = place(merge([skullS.g, ...upperTeeth.map((t) => t.g)]));
const mandibleTarget = place(merge([mandibleS.g, ...teeth.filter((t) => !upperTeeth.includes(t)).map((t) => t.g)]));
const full = await scan(sources.skull, skullTarget, "skull (full)");
const mandible = (await scan(sources.mandible, mandibleTarget, "mandible")).g;

// The full skull scan lacks the teeth and the middle of both zygomatic
// arches; the sagittal half of the same specimen has them, so the skull is
// that half and its mirror image; the full scan only places it. The half
// goes onto the left half of the full scan (rigid, same scale; its PCA
// is unlike the full one, so the starts are the 24 axis-aligned orientations,
// each also turned ±30° about every axis). Fidelity is still "scan".
const skull = await (async () => {
  const k = full.scale;
  const half = bake(await readPrims(await download(sources.cranium)), new Matrix4().makeScale(k, k, k));
  const left = subset(full.g, (c) => c.x < 0);
  const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
  const [from, to] = [mean(points(half, 5000)), mean(points(left, 5000))];
  const starts: Matrix4[] = [];
  for (const a of axes)
    for (const b of axes)
      for (const [sa, sb] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        if (a === b) continue;
        const x = a.clone().multiplyScalar(sa);
        const y = b.clone().multiplyScalar(sb);
        const r = new Matrix4().makeBasis(x, y, x.clone().cross(y));
        for (const turn of [new Matrix4(), ...axes.flatMap((t) => [0.5, -0.5].map((angle) => new Matrix4().makeRotationAxis(t, angle)))]) {
          starts.push(new Matrix4().makeTranslation(to.x, to.y, to.z).multiply(turn).multiply(r).multiply(new Matrix4().makeTranslation(-from.x, -from.y, -from.z)));
        }
      }
  const { m, rms } = register(half, left, starts, { keep: 0.6 });
  console.log(`skull (half): ICP rms ${(rms * 1000).toFixed(2)} mm onto the full scan`);
  // Plane of symmetry of the full scan: its mirror image registered onto it
  // makes a reflection about that plane. The half is moved so that plane is
  // x=0 (a turn of a few degrees at most), cut there and mirrored.
  const reflect = register(mirror(full.g), full.g, [new Matrix4()]).m.multiply(new Matrix4().makeScale(-1, 1, 1));
  const q = mean(points(full.g, 5000)).add(new Vector3(0.03, 0, 0));
  const r = q.clone().applyMatrix4(reflect);
  const n = q.clone().sub(r).normalize();
  const o = q.clone().add(r).multiplyScalar(0.5);
  const align = new Matrix4()
    .makeTranslation(0, o.y, o.z)
    .multiply(new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(n, new Vector3(1, 0, 0))))
    .multiply(new Matrix4().makeTranslation(-o.x, -o.y, -o.z));
  console.log(`skull plane of symmetry: x=${(o.x * 1000).toFixed(1)} mm, ${((Math.acos(Math.min(1, n.x)) * 180) / Math.PI).toFixed(1)}° from the median plane`);
  // The saw cut took a strip a few millimetres wide: its capped face is the
  // densest slab of vertices next to the median plane. The gap is closed by
  // pulling the medial 15 mm of the half towards the plane (smoothly, so the
  // arches and everything lateral keep their place). Loose scan debris (tiny
  // disconnected pieces) is dropped.
  const placed = subset(transform(half, align.multiply(m)), (c) => c.x <= 0);
  const bins = new Map<number, number>();
  for (const p of points(placed)) if (p.x > -0.006) bins.set(Math.floor(p.x / 0.00025), (bins.get(Math.floor(p.x / 0.00025)) ?? 0) + 1);
  const cut = -([...bins].sort((x, y) => y[1] - x[1])[0][0] + 0.5) * 0.00025;
  console.log(`skull (half): saw cut ${(cut * 1000).toFixed(1)} mm from the median plane`);
  const band = 0.015;
  for (let i = 0; i < placed.position.length; i += 3) {
    const t = Math.min(1, Math.max(0, (-cut - placed.position[i]) / band));
    placed.position[i] = Math.min(0, placed.position[i] + cut * (1 - t * t * (3 - 2 * t)));
  }
  // The flattened cut face lies inside the skull once mirrored: drop it, so
  // the two halves weld along the plane and simplify as one surface.
  const index: number[] = [];
  const [e1, e2] = [new Vector3(), new Vector3()];
  for (let i = 0; i < placed.index.length; i += 3) {
    const [p, q, r] = [0, 1, 2].map((j) => new Vector3().fromArray(placed.position, placed.index[i + j] * 3));
    const n = e1.subVectors(q, p).cross(e2.subVectors(r, p)).normalize();
    if ((p.x + q.x + r.x) / 3 < -0.0005 || Math.abs(n.x) < 0.7) index.push(placed.index[i], placed.index[i + 1], placed.index[i + 2]);
  }
  const pieces = components({ position: placed.position, index: new Uint32Array(index) });
  const kept = pieces.filter((g) => g.index.length >= pieces[0].index.length * 0.002);
  console.log(`skull (half): ${pieces.length - kept.length} of ${pieces.length} loose pieces dropped`);
  const whole = merge(kept);
  return merge([whole, mirror(whole)]);
})();

// ---------------------------------------------------------------------------
// Modeled bones (illustrative).

// Rod through `line` (capsules joint to joint), radius from r0 to r1. Inner
// joints overlap by a radius so the rod has no waist there.
function rod(line: V[], r0: number, r1 = r0): Geometry {
  return merge(
    line.slice(1).map((p, i) => {
      const r = r0 + ((r1 - r0) * (i + 0.5)) / (line.length - 1);
      const dir = p.clone().sub(line[i]).normalize().multiplyScalar(r);
      const from = i > 0 ? line[i].clone().sub(dir) : line[i];
      const to = i < line.length - 2 ? p.clone().add(dir) : p;
      return capsule(from.toArray() as Vec, to.toArray() as Vec, r);
    }),
  );
}

// Hyoid apparatus, in a head frame from the skull's long axis: f rostral, v
// ventral in the median plane. On each side the stylohyoid runs
// rostroventrally from the tympanic bulla, the epihyoid descends, the
// ceratohyoid turns caudoventrally to the basihyoid (a transverse bar ventral
// to the mandibular angles) and the thyrohyoid runs caudally to the larynx.
const hyoid = (() => {
  const ps = points(skull, 20000);
  const axis = pca(ps).axes[0];
  const f = axis.clone().multiplyScalar(axis.z < 0 ? 1 : -1).setX(0).normalize();
  const v = new Vector3(0, f.z, -f.y);
  if (v.y > 0) v.negate();
  const along = ps.map((p) => p.dot(f));
  const [back, front] = [Math.min(...along), Math.max(...along)];
  const at = (x: number, fs: number, vs: number) => f.clone().multiplyScalar(fs).addScaledVector(v, vs).setX(x);
  const fv = (p: V) => [p.dot(f), p.dot(v)];
  // Bullae: the most ventral vertices of the caudal third on each side.
  const bulla = (sign: number) => {
    const caudal = ps.filter((p) => p.dot(f) < back + (front - back) * 0.35 && Math.sign(p.x) === sign).sort((a, b) => b.dot(v) - a.dot(v));
    return mean(caudal.slice(0, Math.max(1, Math.floor(caudal.length * 0.03))));
  };
  // Mandibular angle: the most caudal mandible vertices.
  const mps = points(mandible, 20000).sort((a, b) => a.dot(f) - b.dot(f));
  const [angleF, angleV] = fv(mean(mps.slice(0, Math.floor(mps.length * 0.02))));
  const parts: Geometry[] = [];
  const ends: V[] = [];
  for (const sign of [-1, 1]) {
    const b = bulla(sign);
    const [bf, bv] = fv(b);
    const p0 = at(b.x, bf + 0.002, bv + 0.002);
    const p3 = at(sign * 0.004, angleF + 0.004, angleV + 0.006);
    const [f3, v3] = fv(p3);
    const p1 = at(b.x * 0.85, bf + 0.016, bv + (v3 - bv) * 0.45);
    const p2 = at(sign * 0.006, f3 + 0.006, v3 - 0.003);
    const p4 = at(sign * 0.007, f3 - 0.012, v3 - 0.001);
    parts.push(rod([p0, p1], 0.0007, 0.0009), rod([p1, p2], 0.0009), rod([p2, p3], 0.0009, 0.0011), rod([p3, p4], 0.0011, 0.0008));
    ends.push(p3);
  }
  parts.push(rod(ends, 0.0013));
  return merge(parts);
})();

// Clavicles: vestigial, floating in the brachiocephalicus cranial to the
// shoulder joint and medial to the humeral head. Moved cranially until they
// clear every bone by 2 mm.
const placedBones = [...paired.L.values(), ...paired.R.values(), ...spine.map((s) => place(s.g)), ...sternum.map((s) => place(s.g))];
for (const s of ["L", "R"] as const) {
  const head = end(paired[s].get("humerus")!, new Vector3(0, 1, 0), 0.08);
  const near = placedBones.flatMap((g) => points(g).filter((p) => p.distanceTo(head) < 0.06));
  let clavicle: Geometry | null = null;
  for (let shift = 0; shift < 0.03; shift += 0.001) {
    const lateral = new Vector3(head.x * 0.85, head.y + 0.004, head.z - 0.012 - shift);
    const medial = new Vector3(head.x * 0.35, head.y - 0.006, head.z - 0.016 - shift);
    const mid = lateral.clone().lerp(medial, 0.5).add(new Vector3(0, 0, -0.002));
    const g = rod([lateral, lateral.clone().lerp(mid, 0.5).add(new Vector3(0, 0, -0.0007)), mid, medial.clone().lerp(mid, 0.5).add(new Vector3(0, 0, -0.0007)), medial], 0.0009, 0.0012);
    if (Math.min(...points(g, 300).map((p) => Math.min(...near.map((q) => q.distanceTo(p))))) >= 0.002) {
      clavicle = g;
      console.log(`clavicle ${s}: ${(shift * 1000).toFixed(0)} mm cranial shift`);
      break;
    }
  }
  if (!clavicle) throw new Error("clavicle does not clear the bones");
  paired[s].set("clavicle", clavicle);
}

// ---------------------------------------------------------------------------
// Output.

const model = createModel("cat.skeletal", [0.91, 0.89, 0.83, 1]);
const addMesh = model.add;

addMesh(meshKey("cat.skeletal.skull"), skull, 30000);
addMesh(meshKey("cat.skeletal.mandible"), mandible, 15000);
addMesh(meshKey("cat.skeletal.hyoid"), hyoid, 2500);
addMesh(meshKey("cat.skeletal.atlas"), place(spine[0].g), 3500);
addMesh(meshKey("cat.skeletal.axis"), place(spine[1].g), 3500);
for (let i = 2; i < CERVICAL; i++) addMesh(meshKey(`cat.skeletal.vertebrae-cervical.c${i + 1}`), place(spine[i].g), 2500);
for (let i = 0; i < THORACIC; i++) addMesh(meshKey(`cat.skeletal.vertebrae-thoracic.t${i + 1}`), place(spine[CERVICAL + i].g), 2500);
for (let i = 0; i < LUMBAR; i++) addMesh(meshKey(`cat.skeletal.vertebrae-lumbar.l${i + 1}`), place(spine[CERVICAL + THORACIC + i].g), 2500);
addMesh(meshKey("cat.skeletal.sacrum"), place(sacrumS.g), 5000);
caudal.forEach((s, i) => addMesh(meshKey(`cat.skeletal.vertebrae-caudal.cd${i + 1}`), place(s.g), i < 6 ? 1500 : 900));
sternum.forEach((s, i) => addMesh(meshKey(`cat.skeletal.sternum.s${i + 1}`), place(s.g), 900));

const budget: Record<string, number> = {
  scapula: 8000, humerus: 8000, radius: 6000, ulna: 7000, carpus: 4000, metacarpus: 4000, "phalanges-thoracic": 7000,
  "os-coxae": 9000, femur: 8000, patella: 1000, tibia: 8000, fibula: 4000, tarsus: 4000, metatarsus: 4000, "phalanges-pelvic": 7000, clavicle: 600,
};
for (const s of ["L", "R"] as const) {
  for (const [key, g] of paired[s]) addMesh(meshKey(`cat.skeletal.${key}.${s}`), g, budget[key] ?? 1800);
}

await model.write(OUT);
